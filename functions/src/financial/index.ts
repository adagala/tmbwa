import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  MONTHLY_CONTRIBUTION,
  PAYMENT_STATUS,
  auditEventDocumentSchema,
  contributionDocumentSchema,
  notificationEventDocumentSchema,
  paymentDocumentSchema,
} from 'tmbwa-shared';
import {
  availableUnreservedBalance,
  paymentAllocations,
  legacyContributionCorrection,
  correctedPaidAmountValue,
  canReverseLegacyCorrection,
  hasLegacyCorrectionHistory,
  hasLinkedPaymentHistory,
  legacyInventoryCursor,
  requiresReceiptReversalBeforeContributionRemoval,
  reversePayment,
} from './domain';
import {
  contributionData,
  memberData,
  paymentData,
  validateDocumentWrite,
} from '../firestoreData';
import { isActiveStkRequestStatus } from '../kcb/domain';
import { getCurrentMonth } from '../utils';

type CommandData = Record<string, unknown>;

const db = () => admin.firestore();

const stkContributionLockRef = (memberId: string, contributionId: string) =>
  db().doc(
    `members/${memberId}/contributions/${contributionId}/payment_locks/stk`,
  );

const assertNoActiveStkLock = (
  snapshot: FirebaseFirestore.DocumentSnapshot,
) => {
  if (!snapshot.exists) return;
  const lock = snapshot.data() as { status?: unknown };
  if (
    typeof lock.status === 'string' &&
    isActiveStkRequestStatus(lock.status)
  ) {
    throw new HttpsError(
      'failed-precondition',
      'This contribution has an active STK payment request.',
    );
  }
};

const requireAdministrator = (auth: { uid: string; token: Record<string, unknown> } | undefined) => {
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in is required.');
  if (auth.token.role !== 'administrator') {
    throw new HttpsError('permission-denied', 'Administrator access is required.');
  }
  return auth.uid;
};

const requiredString = (data: CommandData, key: string) => {
  const value = data[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpsError('invalid-argument', `${key} is required.`);
  }
  return value.trim();
};

const commandRef = (requestId: string) => db().doc(`financial_commands/${requestId}`);

const writeAuditEvent = (
  transaction: FirebaseFirestore.Transaction,
  requestId: string,
  actorId: string,
  action: string,
  memberId: string,
  targetId: string,
  changes: Record<string, unknown>,
) => {
  const path = `audit_events/${requestId}`;
  transaction.create(db().doc(path), validateDocumentWrite(auditEventDocumentSchema, {
    requestId,
    actorId,
    action,
    memberId,
    targetId,
    changes,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, path));
};

const readCommand = async (
  transaction: FirebaseFirestore.Transaction,
  requestId: string,
) => {
  const ref = commandRef(requestId);
  const snapshot = await transaction.get(ref);
  return { ref, exists: snapshot.exists };
};

const writeCommand = (
  transaction: FirebaseFirestore.Transaction,
  ref: FirebaseFirestore.DocumentReference,
  type: string,
  actorId: string,
) => {
  transaction.create(ref, {
    type,
    actorId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
};

export const recordContributionPayment = onCall(async (request) => {
  requireAdministrator(request.auth);
  throw new HttpsError(
    'failed-precondition',
    'Manual payments are retired. Reconcile payments through KCB.',
  );
});

export const reverseContributionPayment = onCall(async (request) => {
  const actorId = requireAdministrator(request.auth);
  const data = request.data as CommandData;
  const requestId = requiredString(data, 'requestId');
  const memberId = requiredString(data, 'memberId');
  const paymentId = requiredString(data, 'paymentId');

  return db().runTransaction(async (transaction) => {
    const command = await readCommand(transaction, requestId);
    if (command.exists) {
      return { requestId, duplicate: true };
    }
    const paymentRef = db().doc(`members/${memberId}/payments/${paymentId}`);
    const paymentSnapshot = await transaction.get(paymentRef);
    if (!paymentSnapshot.exists) throw new HttpsError('not-found', 'Payment not found.');
    const payment = paymentData(paymentSnapshot);
    const allocations = paymentAllocations(payment);
    if (
      !allocations.length &&
      typeof payment.provider_transaction_id !== 'string'
    ) {
      throw new HttpsError(
        'failed-precondition',
        'Payment has no contribution allocations.',
      );
    }
    const contributionRefs = allocations.map(({ contributionId }) =>
      db().doc(`members/${memberId}/contributions/${contributionId}`));
    const lockRefs = allocations.map(({ contributionId }) =>
      stkContributionLockRef(memberId, contributionId));
    const relatedSnapshots = await Promise.all([
      ...contributionRefs.map((ref) => transaction.get(ref)),
      ...lockRefs.map((ref) => transaction.get(ref)),
    ]);
    const contributionSnapshots = relatedSnapshots.slice(
      0,
      contributionRefs.length,
    );
    const lockSnapshots = relatedSnapshots.slice(contributionRefs.length);
    if (contributionSnapshots.some((item) => !item.exists)) {
      throw new HttpsError('not-found', 'Contribution not found.');
    }
    lockSnapshots.forEach(assertNoActiveStkLock);
    const contributions = contributionSnapshots.map(contributionData);
    writeCommand(transaction, command.ref, 'reverseContributionPayment', actorId);
    transaction.delete(paymentRef);
    allocations.forEach((allocation, index) => {
      const contribution = contributions[index];
      const reversal = reversePayment(
        Number(contribution.balance), allocation.amount, Number(contribution.amount),
      );
      transaction.update(contributionRefs[index], {
        payments: contribution.payments.filter(
          (item) => item.payment_id !== payment.payment_id,
        ),
        balance: reversal.restoredBalance,
        paid: reversal.status,
      });
      transaction.set(db().doc(`monthly_stats/${allocation.contributionId}`), {
        contribution: admin.firestore.FieldValue.increment(-allocation.amount),
        month: allocation.contributionId,
      }, { merge: true });
    });
    transaction.update(db().doc(`members/${memberId}`), {
      balance: admin.firestore.FieldValue.increment(-Number(payment.amount)),
      contributionBalance: admin.firestore.FieldValue.increment(
        -allocations.reduce((sum, item) => sum + item.amount, 0),
      ),
      ...(payment.credit_reserved === true ? {
        reservedKcbCredit: admin.firestore.FieldValue.increment(
          -Number(payment.unallocated_amount ?? 0),
        ),
      } : {}),
    });
    if (typeof payment.provider_transaction_id === 'string') {
      transaction.update(
        db().doc(`kcb_payment_notifications/${payment.provider_transaction_id}`),
        {
          status: 'reversed',
          unallocatedAmount: 0,
          reversedAt: admin.firestore.FieldValue.serverTimestamp(),
          reversedBy: actorId,
        },
      );
    }
    writeAuditEvent(transaction, requestId, actorId, 'payment.reversed', memberId, paymentId, {
      amount: Number(payment.amount),
      contributionAmount: Number(payment.contribution_amount),
      allocations,
    });
    const notificationPath = `notification_events/payment-reversed-${paymentId}`;
    transaction.create(db().doc(notificationPath), validateDocumentWrite(notificationEventDocumentSchema, {
      type: 'payment.reversed', memberId, paymentId,
      receiptNumber: payment.receipt_number ?? payment.referencenumber,
      amount: Number(payment.amount),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, notificationPath));
    return { requestId, duplicate: false };
  });
});

export const createContribution = onCall(async (request) => {
  const actorId = requireAdministrator(request.auth);
  const data = request.data as CommandData;
  const requestId = requiredString(data, 'requestId');
  const memberId = requiredString(data, 'memberId');
  const month = requiredString(data, 'month');
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month)) {
    throw new HttpsError('invalid-argument', 'month must use YYYY-MM-01.');
  }

  return db().runTransaction(async (transaction) => {
    const command = await readCommand(transaction, requestId);
    if (command.exists) {
      return { requestId, duplicate: true };
    }
    const memberRef = db().doc(`members/${memberId}`);
    const contributionRef = db().doc(`members/${memberId}/contributions/${month}`);
    const [memberSnapshot, contributionSnapshot] = await Promise.all([
      transaction.get(memberRef),
      transaction.get(contributionRef),
    ]);
    if (!memberSnapshot.exists) throw new HttpsError('not-found', 'Member not found.');
    if (contributionSnapshot.exists) throw new HttpsError('already-exists', 'Contribution already exists.');
    const member = memberData(memberSnapshot);
    if (member.status !== 'active') throw new HttpsError('failed-precondition', 'Only active members can receive new contributions.');
    const balance = Number(member.balance ?? 0);
    const applied = Math.min(
      availableUnreservedBalance(balance, Number(member.reservedKcbCredit ?? 0)),
      MONTHLY_CONTRIBUTION,
    );
    const payments: Record<string, unknown>[] = [];
    if (applied > 0) {
      const paymentId = db().collection(`members/${memberId}/payments`).doc().id;
      const createdAt = admin.firestore.Timestamp.now();
      const payment = {
        payment_id: paymentId,
        referencenumber: 'BALANCE B/F',
        amount: applied,
        paymentdate: createdAt,
        created_at: createdAt,
        member_id: memberId,
        contribution_id: month,
        firstname: member.firstname,
        lastname: member.lastname,
        contribution_amount: applied,
        payment_type: 'contribution',
        action_by: actorId,
        request_id: requestId,
        receipt_number: `TMBWA-${paymentId.toUpperCase()}`,
      };
      const validatedPayment = validateDocumentWrite(
        paymentDocumentSchema,
        payment,
        `members/${memberId}/payments/${paymentId}`,
      );
      payments.push(validatedPayment);
      transaction.create(db().doc(`members/${memberId}/payments/${paymentId}`), validatedPayment);
    }
    writeCommand(transaction, command.ref, 'createContribution', actorId);
    transaction.create(contributionRef, validateDocumentWrite(contributionDocumentSchema, {
      ...member,
      member_id: memberId,
      amount: MONTHLY_CONTRIBUTION,
      balance: MONTHLY_CONTRIBUTION - applied,
      paid: applied === MONTHLY_CONTRIBUTION ? PAYMENT_STATUS.PAID : applied > 0 ? PAYMENT_STATUS.PARTIAL : PAYMENT_STATUS.UNPAID,
      payments,
      createdat: admin.firestore.FieldValue.serverTimestamp(),
      month,
      action_by: actorId,
      request_id: requestId,
      contribution_id: month,
    }, contributionRef.path));
    transaction.update(memberRef, {
      balance: admin.firestore.FieldValue.increment(-MONTHLY_CONTRIBUTION),
      contributionBalance: admin.firestore.FieldValue.increment(applied),
    });
    transaction.set(db().doc(`monthly_stats/${month}`), {
      amount: admin.firestore.FieldValue.increment(MONTHLY_CONTRIBUTION),
      contribution: admin.firestore.FieldValue.increment(applied),
      paymentsCount: admin.firestore.FieldValue.increment(payments.length),
      month,
    }, { merge: true });
    writeAuditEvent(transaction, requestId, actorId, 'contribution.created', memberId, month, {
      amount: MONTHLY_CONTRIBUTION,
      appliedFromBalance: applied,
    });
    if (MONTHLY_CONTRIBUTION - applied > 0) {
      const notificationPath = `notification_events/contribution-created-${requestId}`;
      transaction.create(db().doc(notificationPath), validateDocumentWrite(notificationEventDocumentSchema, {
        type: 'contribution.created', memberId, contributionId: month,
        amount: MONTHLY_CONTRIBUTION, balance: MONTHLY_CONTRIBUTION - applied,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }, notificationPath));
    }
    return { requestId, duplicate: false };
  });
});

export const adjustMemberBalance = onCall(async (request) => {
  requireAdministrator(request.auth);
  throw new HttpsError(
    'failed-precondition',
    'Manual balance adjustments are retired. Use KCB reconciliation or a legacy correction.',
  );
});

export const correctLegacyContribution = onCall(async (request) => {
  const actorId = requireAdministrator(request.auth);
  const data = request.data as CommandData;
  const requestId = requiredString(data, 'requestId');
  const memberId = requiredString(data, 'memberId');
  const contributionId = requiredString(data, 'contributionId');
  const reason = requiredString(data, 'reason');
  let correctedPaidAmount: number;
  try {
    correctedPaidAmount = correctedPaidAmountValue(data.correctedPaidAmount);
  } catch (error) {
    throw new HttpsError('invalid-argument', (error as Error).message);
  }
  if (contributionId > getCurrentMonth()) {
    throw new HttpsError('invalid-argument', 'Future contributions cannot be corrected.');
  }
  const reference = typeof data.reference === 'string' ? data.reference.trim() : '';
  const notes = typeof data.notes === 'string' ? data.notes.trim() : '';
  const originalPaymentDateMillis = typeof data.originalPaymentDateMillis === 'number'
    ? data.originalPaymentDateMillis : undefined;

  return db().runTransaction(async (transaction) => {
    const command = await readCommand(transaction, requestId);
    if (command.exists) return { requestId, duplicate: true };
    const memberRef = db().doc(`members/${memberId}`);
    const contributionRef = db().doc(`members/${memberId}/contributions/${contributionId}`);
    const [memberSnapshot, contributionSnapshot, stkLockSnapshot] = await Promise.all([
      transaction.get(memberRef), transaction.get(contributionRef),
      transaction.get(stkContributionLockRef(memberId, contributionId)),
    ]);
    if (!memberSnapshot.exists || !contributionSnapshot.exists) {
      throw new HttpsError('not-found', 'Member or contribution not found.');
    }
    assertNoActiveStkLock(stkLockSnapshot);
    memberData(memberSnapshot);
    const contribution = contributionData(contributionSnapshot);
    if (hasLinkedPaymentHistory(contribution.payments)) {
      throw new HttpsError(
        'failed-precondition',
        'A payment is linked to this contribution. Reverse that receipt before applying a legacy correction.',
      );
    }
    let correction: ReturnType<typeof legacyContributionCorrection>;
    try {
      correction = legacyContributionCorrection(
        Number(contribution.amount), Number(contribution.balance), correctedPaidAmount,
      );
    } catch (error) {
      throw new HttpsError('invalid-argument', (error as Error).message);
    }
    if (correction.delta === 0) {
      throw new HttpsError('failed-precondition', 'The contribution already has this paid amount.');
    }
    const correctionRef = db().doc(`members/${memberId}/legacy_corrections/${requestId}`);
    const correctionRecord = {
      correctionId: requestId,
      memberId,
      contributionId,
      source: 'legacy_correction',
      reason,
      reference: reference || null,
      notes: notes || null,
      originalPaymentDate: originalPaymentDateMillis
        ? admin.firestore.Timestamp.fromMillis(originalPaymentDateMillis) : null,
      before: { balance: Number(contribution.balance), paid: contribution.paid,
        paidAmount: correction.currentPaidAmount },
      after: { balance: correction.correctedBalance, paid: correction.status,
        paidAmount: correction.correctedPaidAmount },
      delta: correction.delta,
      previousCorrectionId: contribution.active_legacy_correction_id ?? null,
      reversed: false,
      actorId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    writeCommand(transaction, command.ref, 'correctLegacyContribution', actorId);
    transaction.create(correctionRef, correctionRecord);
    transaction.update(contributionRef, {
      balance: correction.correctedBalance,
      paid: correction.status,
      active_legacy_correction_id: requestId,
      legacy_corrections: admin.firestore.FieldValue.arrayUnion({
        correctionId: requestId, delta: correction.delta, reason,
        source: 'legacy_correction', actorId,
        createdAt: admin.firestore.Timestamp.now(), reversed: false, type: 'correction',
      }),
    });
    transaction.update(memberRef, {
      balance: admin.firestore.FieldValue.increment(correction.delta),
      contributionBalance: admin.firestore.FieldValue.increment(correction.delta),
    });
    transaction.set(db().doc(`monthly_stats/${contributionId}`), {
      contribution: admin.firestore.FieldValue.increment(correction.delta),
      month: contributionId,
    }, { merge: true });
    writeAuditEvent(transaction, requestId, actorId, 'legacy_contribution.corrected',
      memberId, contributionId, correctionRecord);
    return { requestId, correctionId: requestId, delta: correction.delta, duplicate: false };
  });
});

export const reverseLegacyContributionCorrection = onCall(async (request) => {
  const actorId = requireAdministrator(request.auth);
  const data = request.data as CommandData;
  const requestId = requiredString(data, 'requestId');
  const memberId = requiredString(data, 'memberId');
  const correctionId = requiredString(data, 'correctionId');
  const reason = requiredString(data, 'reason');
  return db().runTransaction(async (transaction) => {
    const command = await readCommand(transaction, requestId);
    if (command.exists) return { requestId, duplicate: true };
    const correctionRef = db().doc(`members/${memberId}/legacy_corrections/${correctionId}`);
    const correctionSnapshot = await transaction.get(correctionRef);
    if (!correctionSnapshot.exists) throw new HttpsError('not-found', 'Legacy correction not found.');
    const correction = correctionSnapshot.data() as {
      reversed?: boolean;
      contributionId?: unknown;
      delta?: unknown;
      previousCorrectionId?: unknown;
      before?: { balance?: unknown; paid?: unknown };
      after?: { balance?: unknown };
    };
    if (correction.reversed) throw new HttpsError('failed-precondition', 'Correction is already reversed.');
    const contributionId = String(correction.contributionId);
    const contributionRef = db().doc(`members/${memberId}/contributions/${contributionId}`);
    const [contributionSnapshot, stkLockSnapshot] = await Promise.all([
      transaction.get(contributionRef),
      transaction.get(stkContributionLockRef(memberId, contributionId)),
    ]);
    if (!contributionSnapshot.exists) throw new HttpsError('not-found', 'Contribution not found.');
    assertNoActiveStkLock(stkLockSnapshot);
    const contribution = contributionData(contributionSnapshot);
    if (!correction.before || !correction.after || !canReverseLegacyCorrection(
      contribution.active_legacy_correction_id,
      correctionId,
      Number(contribution.balance),
      Number(correction.after.balance),
    )) {
      throw new HttpsError(
        'failed-precondition',
        'This is not the latest active correction. Reverse newer corrections first.',
      );
    }
    const delta = Number(correction.delta);
    writeCommand(transaction, command.ref, 'reverseLegacyContributionCorrection', actorId);
    transaction.update(correctionRef, { reversed: true, reversedBy: actorId, reversalReason: reason,
      reversedAt: admin.firestore.FieldValue.serverTimestamp(), reversalRequestId: requestId });
    transaction.update(contributionRef, {
      balance: Number(correction.before.balance),
      paid: String(correction.before.paid),
      active_legacy_correction_id: typeof correction.previousCorrectionId === 'string'
        ? correction.previousCorrectionId : admin.firestore.FieldValue.delete(),
      legacy_corrections: admin.firestore.FieldValue.arrayUnion({
        correctionId, delta: -delta, reason,
        source: 'legacy_correction', actorId,
        createdAt: admin.firestore.Timestamp.now(), reversed: true, type: 'reversal',
      }),
    });
    transaction.update(db().doc(`members/${memberId}`), {
      balance: admin.firestore.FieldValue.increment(-delta),
      contributionBalance: admin.firestore.FieldValue.increment(-delta),
    });
    transaction.set(db().doc(`monthly_stats/${contributionId}`), {
      contribution: admin.firestore.FieldValue.increment(-delta), month: contributionId,
    }, { merge: true });
    writeAuditEvent(transaction, requestId, actorId, 'legacy_contribution.correction_reversed',
      memberId, contributionId, { correctionId, reason, delta: -delta });
    return { requestId, correctionId, duplicate: false };
  });
});

export const listLegacyContributionInventory = onCall(async (request) => {
  requireAdministrator(request.auth);
  const data = request.data as CommandData | undefined;
  const requestedLimit = Number(data?.limit ?? 200);
  const limit = Math.min(Math.max(Number.isInteger(requestedLimit) ? requestedLimit : 200, 1), 500);
  let cursor: string | undefined;
  try {
    cursor = legacyInventoryCursor(data?.cursor);
  } catch (error) {
    throw new HttpsError('invalid-argument', (error as Error).message);
  }
  let query: FirebaseFirestore.Query = db().collectionGroup('contributions')
    .orderBy(admin.firestore.FieldPath.documentId());
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.limit(limit + 1).get();
  const hasMore = snapshot.size > limit;
  const documents = snapshot.docs.slice(0, limit);
  return {
    scanned: documents.length,
    nextCursor: hasMore ? documents[documents.length - 1].ref.path : null,
    records: documents.map((document) => {
      const data = document.data();
      const payments = Array.isArray(data.payments)
        ? data.payments as Array<Record<string, unknown>> : [];
      const amount = Number(data.amount);
      const balance = Number(data.balance);
      const validTotals = Number.isFinite(amount) && amount > 0 &&
        Number.isFinite(balance) && balance >= 0 && balance <= amount;
      const kcbLinked = payments.some((payment) =>
        typeof payment.provider_transaction_id === 'string' ||
        (Array.isArray(payment.allocations) && payment.allocations.length > 1));
      return {
        path: document.ref.path,
        memberId: document.ref.parent.parent?.id ?? '',
        contributionId: document.id,
        amount: validTotals ? amount : null,
        balance: validTotals ? balance : null,
        paid: typeof data.paid === 'string' ? data.paid : null,
        paymentCount: payments.length,
        kcbLinked,
        needsReview: !validTotals || (!kcbLinked && payments.length === 0 && balance < amount),
      };
    }),
  };
});

export const removeContribution = onCall(async (request) => {
  const actorId = requireAdministrator(request.auth);
  const data = request.data as CommandData;
  const requestId = requiredString(data, 'requestId');
  const memberId = requiredString(data, 'memberId');
  const contributionId = requiredString(data, 'contributionId');
  return db().runTransaction(async (transaction) => {
    const command = await readCommand(transaction, requestId);
    if (command.exists) {
      return { requestId, duplicate: true };
    }
    const contributionRef = db().doc(`members/${memberId}/contributions/${contributionId}`);
    const [contributionSnapshot, stkLockSnapshot] = await Promise.all([
      transaction.get(contributionRef),
      transaction.get(stkContributionLockRef(memberId, contributionId)),
    ]);
    if (!contributionSnapshot.exists) throw new HttpsError('not-found', 'Contribution not found.');
    assertNoActiveStkLock(stkLockSnapshot);
    const contribution = contributionData(contributionSnapshot);
    if (hasLegacyCorrectionHistory(contribution.legacy_corrections)) {
      throw new HttpsError(
        'failed-precondition',
        'Contributions with audited legacy correction history cannot be removed.',
      );
    }
    const payments = Array.isArray(contribution.payments) ? contribution.payments : [];
    const paymentRefs = payments.map((payment) =>
      db().doc(`members/${memberId}/payments/${payment.payment_id}`));
    const paymentSnapshots = await Promise.all(
      paymentRefs.map((ref) => transaction.get(ref)),
    );
    if (paymentSnapshots.some((snapshot) => !snapshot.exists)) {
      throw new HttpsError(
        'data-loss',
        'A contribution payment record is missing. The contribution cannot be removed safely.',
      );
    }
    const canonicalPayments = paymentSnapshots.map(paymentData);
    if (canonicalPayments.some(requiresReceiptReversalBeforeContributionRemoval)) {
      throw new HttpsError(
        'failed-precondition',
        'Reverse the linked receipt before removing this contribution.',
      );
    }
    const paidAmount = Number(contribution.amount ?? 0) - Number(contribution.balance ?? 0);
    writeCommand(transaction, command.ref, 'removeContribution', actorId);
    paymentRefs.forEach((paymentRef) => transaction.delete(paymentRef));
    transaction.delete(contributionRef);
    transaction.update(db().doc(`members/${memberId}`), {
      contributionBalance: admin.firestore.FieldValue.increment(-paidAmount),
    });
    transaction.set(db().doc(`monthly_stats/${contributionId}`), {
      amount: admin.firestore.FieldValue.increment(-Number(contribution.amount ?? 0)),
      contribution: admin.firestore.FieldValue.increment(-paidAmount),
      paymentsCount: admin.firestore.FieldValue.increment(-payments.length),
      month: contributionId,
    }, { merge: true });
    writeAuditEvent(transaction, requestId, actorId, 'contribution.removed', memberId, contributionId, {
      amount: Number(contribution.amount ?? 0),
      paidAmount,
      removedPaymentIds: payments.map((payment) => payment.payment_id),
    });
    return { requestId, duplicate: false };
  });
});

export const deleteMemberSafely = onCall(async (request) => {
  const actorId = requireAdministrator(request.auth);
  const data = request.data as CommandData;
  const requestId = requiredString(data, 'requestId');
  const memberId = requiredString(data, 'memberId');
  return db().runTransaction(async (transaction) => {
    const command = await readCommand(transaction, requestId);
    if (command.exists) return { requestId, duplicate: true };
    const memberRef = db().doc(`members/${memberId}`);
    const [memberSnapshot, contributions] = await Promise.all([
      transaction.get(memberRef),
      transaction.get(db().collection(`members/${memberId}/contributions`)),
    ]);
    if (!memberSnapshot.exists) {
      throw new HttpsError('not-found', 'Member not found.');
    }
    const lockSnapshots = await Promise.all(
      contributions.docs.map((contribution) =>
        transaction.get(stkContributionLockRef(memberId, contribution.id))),
    );
    lockSnapshots.forEach(assertNoActiveStkLock);
    writeCommand(transaction, command.ref, 'deleteMemberSafely', actorId);
    transaction.delete(memberRef);
    writeAuditEvent(
      transaction,
      requestId,
      actorId,
      'member.deleted',
      memberId,
      memberId,
      { contributionCount: contributions.size },
    );
    return { requestId, duplicate: false };
  });
});

const lifecycleTransitions: Record<string, string[]> = {
  active: ['inactive', 'suspended', 'resigned', 'deceased'],
  inactive: ['active', 'suspended', 'resigned', 'deceased'],
  suspended: ['active', 'inactive', 'resigned', 'deceased'],
  resigned: [],
  deceased: [],
};

export const transitionMemberStatus = onCall(async (request) => {
  const actorId = requireAdministrator(request.auth);
  const data = request.data as CommandData;
  const requestId = requiredString(data, 'requestId');
  const memberId = requiredString(data, 'memberId');
  const status = requiredString(data, 'status');
  if (!Object.prototype.hasOwnProperty.call(lifecycleTransitions, status)) {
    throw new HttpsError('invalid-argument', 'Unsupported member status.');
  }
  const result = await db().runTransaction(async (transaction) => {
    const command = await readCommand(transaction, requestId);
    const memberRef = db().doc(`members/${memberId}`);
    const snapshot = await transaction.get(memberRef);
    if (!snapshot.exists) throw new HttpsError('not-found', 'Member not found.');
    const previousStatus = memberData(snapshot).status;
    if (command.exists || previousStatus === status) {
      return { requestId, status: previousStatus, duplicate: true };
    }
    if (!lifecycleTransitions[previousStatus]?.includes(status)) {
      throw new HttpsError(
        'failed-precondition',
        `Cannot transition from ${previousStatus} to ${status}.`,
      );
    }
    writeCommand(transaction, command.ref, 'transitionMemberStatus', actorId);
    transaction.update(memberRef, { status, statusUpdatedAt: admin.firestore.FieldValue.serverTimestamp(), statusUpdatedBy: actorId });
    writeAuditEvent(transaction, requestId, actorId, 'member.status_changed', memberId, memberId, { previousStatus, newStatus: status });
    return { requestId, previousStatus, status, duplicate: false };
  });
  await admin.auth().updateUser(memberId, { disabled: result.status !== 'active' });
  await admin.auth().revokeRefreshTokens(memberId);
  return result;
});
