import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { MONTHLY_CONTRIBUTION, PAYMENT_STATUS } from 'tmbwa-shared';
import { applyBalanceAdjustment, applyPayment, reversePayment } from './domain';

type CommandData = Record<string, unknown>;

const db = () => admin.firestore();

const documentData = (snapshot: FirebaseFirestore.DocumentSnapshot, label: string) => {
  const data = snapshot.data();
  if (!data) throw new HttpsError('not-found', `${label} not found.`);
  return data;
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

const positiveNumber = (data: CommandData, key: string) => {
  const value = data[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new HttpsError('invalid-argument', `${key} must be greater than zero.`);
  }
  return value;
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
  transaction.create(db().doc(`audit_events/${requestId}`), {
    requestId,
    actorId,
    action,
    memberId,
    targetId,
    changes,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
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
  const actorId = requireAdministrator(request.auth);
  const data = request.data as CommandData;
  const requestId = requiredString(data, 'requestId');
  const memberId = requiredString(data, 'memberId');
  const contributionId = requiredString(data, 'contributionId');
  const referenceNumber = requiredString(data, 'referenceNumber');
  const amount = positiveNumber(data, 'amount');
  const paymentDateMillis = positiveNumber(data, 'paymentDateMillis');

  return db().runTransaction(async (transaction) => {
    const command = await readCommand(transaction, requestId);
    if (command.exists) {
      return { requestId, duplicate: true };
    }
    const memberRef = db().doc(`members/${memberId}`);
    const contributionRef = db().doc(`members/${memberId}/contributions/${contributionId}`);
    const [memberSnapshot, contributionSnapshot] = await Promise.all([
      transaction.get(memberRef),
      transaction.get(contributionRef),
    ]);
    if (!memberSnapshot.exists || !contributionSnapshot.exists) {
      throw new HttpsError('not-found', 'Member or contribution not found.');
    }
    const member = documentData(memberSnapshot, 'Member');
    const contribution = documentData(contributionSnapshot, 'Contribution');
    const outstanding = Number(contribution.balance ?? 0);
    if (outstanding <= 0) throw new HttpsError('failed-precondition', 'Contribution is already paid.');

    const paymentResult = applyPayment(amount, outstanding);
    const { contributionAmount } = paymentResult;
    const paymentId = db().collection(`members/${memberId}/payments`).doc().id;
    const receiptNumber = `TMBWA-${paymentId.toUpperCase()}`;
    const createdAt = admin.firestore.Timestamp.now();
    const payment = {
      payment_id: paymentId,
      referencenumber: referenceNumber,
      amount,
      paymentdate: admin.firestore.Timestamp.fromMillis(paymentDateMillis),
      created_at: createdAt,
      member_id: memberId,
      contribution_id: contributionId,
      firstname: member.firstname,
      lastname: member.lastname,
      contribution_amount: contributionAmount,
      payment_type: 'contribution',
      action_by: actorId,
      request_id: requestId,
      receipt_number: receiptNumber,
    };
    writeCommand(transaction, command.ref, 'recordContributionPayment', actorId);
    transaction.create(db().doc(`members/${memberId}/payments/${paymentId}`), payment);
    transaction.update(contributionRef, {
      payments: admin.firestore.FieldValue.arrayUnion(payment),
      balance: paymentResult.remainingBalance,
      paid: paymentResult.status,
    });
    transaction.update(memberRef, {
      balance: admin.firestore.FieldValue.increment(amount),
      contributionBalance: admin.firestore.FieldValue.increment(contributionAmount),
    });
    transaction.set(db().doc(`monthly_stats/${contributionId}`), {
      contribution: admin.firestore.FieldValue.increment(contributionAmount),
      month: contributionId,
    }, { merge: true });
    writeAuditEvent(transaction, requestId, actorId, 'payment.recorded', memberId, paymentId, {
      amount,
      contributionAmount,
      contributionId,
      referenceNumber,
    });
    return { requestId, paymentId, receiptNumber, contributionAmount, duplicate: false };
  });
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
    const payment = documentData(paymentSnapshot, 'Payment');
    const contributionId = String(payment.contribution_id || '');
    if (!contributionId) throw new HttpsError('failed-precondition', 'Payment is not a contribution payment.');
    const contributionRef = db().doc(`members/${memberId}/contributions/${contributionId}`);
    const contributionSnapshot = await transaction.get(contributionRef);
    if (!contributionSnapshot.exists) throw new HttpsError('not-found', 'Contribution not found.');
    const contribution = documentData(contributionSnapshot, 'Contribution');
    const reversal = reversePayment(
      Number(contribution.balance ?? 0),
      Number(payment.contribution_amount ?? 0),
      Number(contribution.amount),
    );
    writeCommand(transaction, command.ref, 'reverseContributionPayment', actorId);
    transaction.delete(paymentRef);
    transaction.update(contributionRef, {
      payments: admin.firestore.FieldValue.arrayRemove(payment),
      balance: reversal.restoredBalance,
      paid: reversal.status,
    });
    transaction.update(db().doc(`members/${memberId}`), {
      balance: admin.firestore.FieldValue.increment(-Number(payment.amount)),
      contributionBalance: admin.firestore.FieldValue.increment(-Number(payment.contribution_amount)),
    });
    transaction.set(db().doc(`monthly_stats/${contributionId}`), {
      contribution: admin.firestore.FieldValue.increment(-Number(payment.contribution_amount)),
      month: contributionId,
    }, { merge: true });
    writeAuditEvent(transaction, requestId, actorId, 'payment.reversed', memberId, paymentId, {
      amount: Number(payment.amount),
      contributionAmount: Number(payment.contribution_amount),
      contributionId,
    });
    transaction.create(db().doc(`notification_events/payment-reversed-${paymentId}`), {
      type: 'payment.reversed', memberId, paymentId,
      receiptNumber: payment.receipt_number ?? payment.referencenumber,
      amount: Number(payment.amount), contributionId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
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
    const member = documentData(memberSnapshot, 'Member');
    if (member.status !== 'active') throw new HttpsError('failed-precondition', 'Only active members can receive new contributions.');
    const balance = Number(member.balance ?? 0);
    const applied = Math.min(Math.max(balance, 0), MONTHLY_CONTRIBUTION);
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
      payments.push(payment);
      transaction.create(db().doc(`members/${memberId}/payments/${paymentId}`), payment);
    }
    writeCommand(transaction, command.ref, 'createContribution', actorId);
    transaction.create(contributionRef, {
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
    });
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
      transaction.create(db().doc(`notification_events/contribution-created-${requestId}`), {
        type: 'contribution.created', memberId, contributionId: month,
        amount: MONTHLY_CONTRIBUTION, balance: MONTHLY_CONTRIBUTION - applied,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    return { requestId, duplicate: false };
  });
});

export const adjustMemberBalance = onCall(async (request) => {
  const actorId = requireAdministrator(request.auth);
  const data = request.data as CommandData;
  const requestId = requiredString(data, 'requestId');
  const memberId = requiredString(data, 'memberId');
  const amount = positiveNumber(data, 'amount');
  const type = requiredString(data, 'type');
  if (type !== 'top_up' && type !== 'deduction') {
    throw new HttpsError('invalid-argument', 'type must be top_up or deduction.');
  }
  return db().runTransaction(async (transaction) => {
    const command = await readCommand(transaction, requestId);
    if (command.exists) {
      return { requestId, duplicate: true };
    }
    const memberRef = db().doc(`members/${memberId}`);
    const memberSnapshot = await transaction.get(memberRef);
    if (!memberSnapshot.exists) throw new HttpsError('not-found', 'Member not found.');
    const member = documentData(memberSnapshot, 'Member');
    let nextBalance: number;
    try {
      nextBalance = applyBalanceAdjustment(Number(member.balance ?? 0), amount, type);
    } catch (error) {
      throw new HttpsError('failed-precondition', (error as Error).message);
    }
    const paymentId = db().collection(`members/${memberId}/payments`).doc().id;
    writeCommand(transaction, command.ref, 'adjustMemberBalance', actorId);
    transaction.update(memberRef, { balance: nextBalance });
    transaction.create(db().doc(`members/${memberId}/payments/${paymentId}`), {
      payment_id: paymentId,
      referencenumber: type === 'top_up' ? 'ACCOUNT BALANCE TOP UP' : 'ACCOUNT BALANCE DEDUCTION',
      amount,
      paymentdate: admin.firestore.FieldValue.serverTimestamp(),
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      member_id: memberId,
      contribution_id: '',
      firstname: member.firstname,
      lastname: member.lastname,
      contribution_amount: 0,
      payment_type: 'account',
      balance_direction: type,
      action_by: actorId,
      request_id: requestId,
      receipt_number: `TMBWA-${paymentId.toUpperCase()}`,
    });
    writeAuditEvent(transaction, requestId, actorId, 'balance.adjusted', memberId, paymentId, {
      amount,
      direction: type,
      previousBalance: Number(member.balance ?? 0),
      newBalance: nextBalance,
    });
    return { requestId, paymentId, duplicate: false };
  });
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
    const contributionSnapshot = await transaction.get(contributionRef);
    if (!contributionSnapshot.exists) throw new HttpsError('not-found', 'Contribution not found.');
    const contribution = documentData(contributionSnapshot, 'Contribution');
    const payments = Array.isArray(contribution.payments) ? contribution.payments : [];
    for (const payment of payments) {
      if (payment && typeof payment.payment_id === 'string') {
        transaction.delete(db().doc(`members/${memberId}/payments/${payment.payment_id}`));
      }
    }
    const paidAmount = Number(contribution.amount ?? 0) - Number(contribution.balance ?? 0);
    writeCommand(transaction, command.ref, 'removeContribution', actorId);
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
    const previousStatus = String(snapshot.data()?.status || 'active');
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
