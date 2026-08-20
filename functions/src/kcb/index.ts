import * as admin from 'firebase-admin';
import { createHash, randomUUID } from 'crypto';
import { defineSecret, defineString } from 'firebase-functions/params';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import {
  MEMBER_STATUS,
  PAYMENT_STATUS,
  auditEventDocumentSchema,
  kcbPaymentNotificationDocumentSchema,
  notificationEventDocumentSchema,
  paymentDocumentSchema,
  unallocatedPaymentAmount,
} from 'tmbwa-shared';
import {
  PaymentAllocation,
  paymentAllocations,
  recoverableOutstandingBalance,
  reservableLegacyKcbCredit,
  validatePaymentAllocations,
} from '../financial/domain';
import {
  contributionData,
  kcbPaymentNotificationData,
  kcbStkRequestData,
  memberData,
  paymentData,
  validateDocumentWrite,
} from '../firestoreData';
import {
  acknowledgement,
  isActiveStkRequestStatus,
  isLockedStkReconciliation,
  isManuallyResolvableStkUnknownOutcome,
  isRecoverableStkLeaseStatus,
  isSameStkRequestPayload,
  isStkInitiationLeaseExpired,
  isSuccessfulStkDuplicateStatus,
  lockedStkAllocationAmount,
  normalizeKenyanPhone,
  ownsExpectedStkTransition,
  parseKcbTransactionDate,
  parseStkCallback,
  parseTillNotification,
  permitsUnsignedSandboxNotification,
  secureTokenMatches,
  stkFailureStatus,
  stkPaymentMatchesPendingRequest,
  terminalNotificationMatchesStkRequest,
  unmatchedStkCallbackMatchesRequest,
  verifyKcbSignature,
} from './domain';

type Data = Record<string, unknown>;

const stkCallbackMismatchAuditId = (
  checkoutRequestId: string,
  merchantRequestId: string,
) =>
  `stk-callback-mismatch-${checkoutRequestId}-${createHash('sha256')
    .update(merchantRequestId)
    .digest('hex')
    .slice(0, 16)}`;

const KCB_PUBLIC_KEY = defineString('KCB_PUBLIC_KEY', { default: '' });
const APP_ENV = defineString('APP_ENV', { default: 'production' });
const KCB_DEV_MOCK_ENABLED = defineString('KCB_DEV_MOCK_ENABLED', {
  default: 'false',
});
const KCB_SHARED_REFERENCE = defineString('KCB_SHARED_REFERENCE', {
  default: '7969138',
});
const KCB_CURRENCY = defineString('KCB_CURRENCY', { default: 'KES' });
const KCB_CONSUMER_KEY = defineSecret('KCB_CONSUMER_KEY');
const KCB_CONSUMER_SECRET = defineSecret('KCB_CONSUMER_SECRET');
const KCB_TOKEN_URL = defineString('KCB_TOKEN_URL', {
  default: 'https://uat.buni.kcbgroup.com/token?grant_type=client_credentials',
});
const KCB_STK_URL = defineString('KCB_STK_URL', {
  default: 'https://uat.buni.kcbgroup.com/mm/api/request/1.0.0/stkpush',
});
const KCB_STK_CALLBACK_URL = defineString('KCB_STK_CALLBACK_URL');
const KCB_ORG_SHORTCODE = defineString('KCB_ORG_SHORTCODE', {
  default: '522533',
});
const KCB_STK_ROUTE_CODE = defineString('KCB_STK_ROUTE_CODE', {
  default: '207',
});
const KCB_STK_CALLBACK_TOKEN = defineSecret('KCB_STK_CALLBACK_TOKEN');
const db = () => admin.firestore();
const STK_INITIATION_LEASE_MS = 2 * 60 * 1000;
const STK_DISPATCH_RESOLUTION_DELAY_MS = 5 * 60 * 1000;

const stkContributionLockRef = (memberId: string, contributionId: string) =>
  db().doc(
    `members/${memberId}/contributions/${contributionId}/payment_locks/stk`,
  );

const timestampMillis = (value: unknown) =>
  value && typeof (value as { toMillis?: unknown }).toMillis === 'function'
    ? (value as { toMillis: () => number }).toMillis()
    : undefined;

const assertNoCompetingStkLocks = (
  locks: FirebaseFirestore.DocumentSnapshot[],
  allowedRequestId?: string,
) => {
  for (const lock of locks) {
    if (!lock.exists) continue;
    const data = lock.data() as { requestId?: unknown; status?: unknown };
    if (
      typeof data.status === 'string' &&
      isActiveStkRequestStatus(data.status) &&
      data.requestId !== allowedRequestId
    ) {
      throw new HttpsError(
        'failed-precondition',
        'This contribution has an active STK payment request.',
      );
    }
  }
};

const requireAdministrator = (
  auth: { uid: string; token: Record<string, unknown> } | undefined,
) => {
  if (!auth) {
    throw new HttpsError('unauthenticated', 'Sign in is required.');
  }
  if (auth.token.role !== 'administrator') {
    throw new HttpsError(
      'permission-denied',
      'Administrator access is required.',
    );
  }
  return auth.uid;
};

const requiredString = (data: Data, key: string) => {
  const value = data[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpsError('invalid-argument', `${key} is required.`);
  }
  return value.trim();
};

const requiredAllocations = (value: unknown): PaymentAllocation[] => {
  if (!Array.isArray(value)) {
    throw new HttpsError('invalid-argument', 'allocations must be an array.');
  }
  return value.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new HttpsError('invalid-argument', 'Invalid allocation.');
    }
    const allocation = item as Record<string, unknown>;
    const contributionId = String(allocation.contributionId ?? '').trim();
    const amount = Number(allocation.amount);
    if (!contributionId || !Number.isFinite(amount) || amount <= 0) {
      throw new HttpsError('invalid-argument', 'Invalid allocation.');
    }
    return { contributionId, amount };
  });
};

export const kcbTillNotification = onRequest(
  async (request, response) => {
    if (request.method !== 'POST') {
      response
        .set('Allow', 'POST')
        .status(405)
        .json({ error: 'Method not allowed.' });
      return;
    }
    const transactionId = randomUUID();
    let messageId: string = transactionId;
    let conversationId: string | undefined;
    try {
      const permitsUnsigned = permitsUnsignedSandboxNotification(
        APP_ENV.value(), KCB_DEV_MOCK_ENABLED.value(),
      );
      const signature = request.get('signature') || '';
      if (!permitsUnsigned && !verifyKcbSignature(
        request.rawBody, signature, KCB_PUBLIC_KEY.value(),
      )) {
        logger.warn('Rejected KCB notification with an invalid signature.');
        response
          .status(401)
          .json(
            acknowledgement(
              messageId,
              undefined,
              transactionId,
              false,
              'Invalid signature',
            ),
          );
        return;
      }
      const notification = parseTillNotification(request.body);
      messageId = notification.messageId;
      conversationId = notification.conversationId;
      if (notification.currency !== KCB_CURRENCY.value().toUpperCase()) {
        throw new Error('Unsupported currency.');
      }
      if (notification.billReference !== KCB_SHARED_REFERENCE.value()) {
        throw new Error('Unexpected bill reference.');
      }

      const notificationRef = db().doc(
        `kcb_payment_notifications/${notification.providerTransactionId}`,
      );
      await db().runTransaction(async (transaction) => {
        const existing = await transaction.get(notificationRef);
        if (existing.exists) return;
        const matches = await transaction.get(
          db()
            .collection('members')
            .where('verifiedPhoneNormalized', '==', notification.payerPhone)
            .limit(2),
        );
        const suggestedMemberId =
          matches.size === 1 ? matches.docs[0].id : null;
        transaction.create(
          notificationRef,
          validateDocumentWrite(
            kcbPaymentNotificationDocumentSchema,
            {
              ...notification,
              status: 'unresolved',
              suggestedMemberId,
              matchReason: suggestedMemberId
                ? 'unique_verified_phone'
                : matches.empty
                  ? 'no_verified_phone_match'
                  : 'ambiguous_phone_match',
              receivedAt: admin.firestore.FieldValue.serverTimestamp(),
              provider: 'kcb_buni',
              source: 'till_notification',
            },
            notificationRef.path,
          ),
        );
        transaction.create(
          db().doc(`kcb_notification_messages/${notification.messageId}`),
          {
            providerTransactionId: notification.providerTransactionId,
            receivedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        );
      });
      response
        .status(200)
        .json(
          acknowledgement(
            messageId,
            conversationId,
            transactionId,
            true,
            'Notification received successfully',
          ),
        );
    } catch (error) {
      logger.warn('Rejected invalid KCB notification.', {
        reason: (error as Error).message,
      });
      response
        .status(400)
        .json(
          acknowledgement(
            messageId,
            conversationId,
            transactionId,
            false,
            'Invalid notification',
          ),
        );
    }
  },
);

export const reconcileKcbPayment = onCall(async (request) => {
  const actorId = requireAdministrator(request.auth);
  const data = request.data as Data;
  const requestId = requiredString(data, 'requestId');
  const providerTransactionId = requiredString(data, 'providerTransactionId');
  const memberId = requiredString(data, 'memberId');
  const allocations = requiredAllocations(data.allocations);

  return db().runTransaction(async (transaction) => {
    const commandRef = db().doc(`financial_commands/${requestId}`);
    const notificationRef = db().doc(
      `kcb_payment_notifications/${providerTransactionId}`,
    );
    const memberRef = db().doc(`members/${memberId}`);
    const contributionRefs = allocations.map(({ contributionId }) =>
      db().doc(`members/${memberId}/contributions/${contributionId}`));
    const lockRefs = allocations.map(({ contributionId }) =>
      stkContributionLockRef(memberId, contributionId));
    const snapshots = await Promise.all([
      transaction.get(commandRef),
      transaction.get(notificationRef),
      transaction.get(memberRef),
      ...contributionRefs.map((ref) => transaction.get(ref)),
      ...lockRefs.map((ref) => transaction.get(ref)),
    ]);
    const [command, notificationSnapshot, memberSnapshot] = snapshots;
    const contributionSnapshots = snapshots.slice(3, 3 + contributionRefs.length);
    const lockSnapshots = snapshots.slice(3 + contributionRefs.length);
    if (command.exists) return { requestId, duplicate: true };
    if (!notificationSnapshot.exists) {
      throw new HttpsError('not-found', 'KCB payment notification not found.');
    }
    if (!memberSnapshot.exists || contributionSnapshots.some((item) => !item.exists)) {
      throw new HttpsError('not-found', 'Member or contribution not found.');
    }
    const notification = kcbPaymentNotificationData(notificationSnapshot);
    if (notification.status === 'reconciled') {
      throw new HttpsError(
        'already-exists',
        'This provider payment is already reconciled.',
      );
    }
    if (notification.status !== 'unresolved') {
      throw new HttpsError(
        'failed-precondition',
        'This notification cannot be reconciled.',
      );
    }
    const notificationSource =
      typeof notification.source === 'string' ? notification.source : undefined;
    let lockedMemberId = notification.memberId;
    let lockedContributionId = notification.contributionId;
    let lockedStkRequestId: string | undefined;
    let lockedRequestedAmount: number | undefined;
    if (isLockedStkReconciliation({ source: notificationSource })) {
      lockedStkRequestId =
        typeof notification.stkRequestId === 'string'
          ? notification.stkRequestId
          : undefined;
      if (!lockedStkRequestId) {
        throw new HttpsError(
          'failed-precondition',
          'This STK payment is missing its authoritative reconciliation linkage.',
        );
      }
      const stkRequestSnapshot = await transaction.get(
        db().doc(`kcb_stk_requests/${lockedStkRequestId}`),
      );
      if (!stkRequestSnapshot.exists) {
        throw new HttpsError(
          'failed-precondition',
          'The linked STK request no longer exists.',
        );
      }
      const stkRequest = kcbStkRequestData(stkRequestSnapshot);
      lockedMemberId = stkRequest.memberId;
      lockedContributionId = stkRequest.contributionId;
      lockedRequestedAmount = Number(stkRequest.amount);
    }
    assertNoCompetingStkLocks(lockSnapshots, lockedStkRequestId);
    if (lockedMemberId && lockedMemberId !== memberId) {
      throw new HttpsError(
        'invalid-argument',
        'This payment notification is locked to a different member.',
      );
    }
    if (isLockedStkReconciliation({ source: notificationSource })) {
      const onlyAllocation = allocations[0];
      if (allocations.length !== 1 || !onlyAllocation) {
        throw new HttpsError(
          'invalid-argument',
          'STK payments must reconcile to exactly one contribution allocation.',
        );
      }
      if (onlyAllocation.contributionId !== lockedContributionId) {
        throw new HttpsError(
          'invalid-argument',
          'This STK payment is locked to a different contribution.',
        );
      }
    }

    const member = memberData(memberSnapshot);
    const contributions = contributionSnapshots.map(contributionData);
    const outstanding = Object.fromEntries(contributions.map((item, index) => [
      allocations[index].contributionId,
      Number(item.balance),
    ]));
    if (
      lockedContributionId &&
      lockedRequestedAmount !== undefined
    ) {
      let expectedAllocationAmount: number;
      try {
        expectedAllocationAmount = lockedStkAllocationAmount(
          Number(notification.amount),
          lockedRequestedAmount,
          Number(outstanding[lockedContributionId]),
        );
      } catch (cause) {
        throw new HttpsError('failed-precondition', (cause as Error).message);
      }
      if (Number(allocations[0]?.amount) !== expectedAllocationAmount) {
        throw new HttpsError(
          'invalid-argument',
          `STK allocation must be KES ${expectedAllocationAmount}; any excess remains account credit.`,
        );
      }
    }
    let allocationResult: ReturnType<typeof validatePaymentAllocations>;
    try {
      allocationResult = validatePaymentAllocations(
        Number(notification.amount), allocations, outstanding,
      );
    } catch (cause) {
      throw new HttpsError('invalid-argument', (cause as Error).message);
    }
    const paymentId = db().collection(`members/${memberId}/payments`).doc().id;
    const receiptNumber = `TMBWA-${paymentId.toUpperCase()}`;
    const payment = {
      payment_id: paymentId,
      referencenumber: providerTransactionId,
      amount: Number(notification.amount),
      paymentdate: admin.firestore.Timestamp.fromDate(
        parseKcbTransactionDate(String(notification.transactionDate)),
      ),
      created_at: admin.firestore.Timestamp.now(),
      member_id: memberId,
      contribution_id: allocations[0]?.contributionId ?? '',
      firstname: member.firstname,
      lastname: member.lastname,
      contribution_amount: allocationResult.allocatedAmount,
      payment_type: allocations.length ? 'contribution' : 'account',
      allocations: allocations.map((item) => ({
        contribution_id: item.contributionId,
        amount: item.amount,
      })),
      unallocated_amount: allocationResult.unallocatedAmount,
      credit_reserved: true,
      payment_source: 'kcb_buni',
      provider_transaction_id: providerTransactionId,
      payer_phone: notification.payerPhone,
      action_by: actorId,
      request_id: requestId,
      receipt_number: receiptNumber,
    };

    transaction.create(commandRef, {
      type: 'reconcileKcbPayment',
      actorId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.create(
      db().doc(`members/${memberId}/payments/${paymentId}`),
      validateDocumentWrite(
        paymentDocumentSchema,
        payment,
        `members/${memberId}/payments/${paymentId}`,
      ),
    );
    allocations.forEach((allocation, index) => {
      const remainingBalance = outstanding[allocation.contributionId] - allocation.amount;
      transaction.update(contributionRefs[index], {
        payments: admin.firestore.FieldValue.arrayUnion({
          ...payment,
          contribution_id: allocation.contributionId,
          contribution_amount: allocation.amount,
        }),
        balance: remainingBalance,
        paid: remainingBalance === 0 ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.PARTIAL,
      });
      transaction.set(db().doc(`monthly_stats/${allocation.contributionId}`), {
        contribution: admin.firestore.FieldValue.increment(allocation.amount),
        month: allocation.contributionId,
      }, { merge: true });
    });
    transaction.update(memberRef, {
      balance: admin.firestore.FieldValue.increment(
        Number(notification.amount),
      ),
      contributionBalance: admin.firestore.FieldValue.increment(
        allocationResult.allocatedAmount,
      ),
      reservedKcbCredit: admin.firestore.FieldValue.increment(
        allocationResult.unallocatedAmount,
      ),
    });
    transaction.update(notificationRef, {
      status: 'reconciled',
      memberId,
      allocations,
      unallocatedAmount: allocationResult.unallocatedAmount,
      creditReserved: true,
      paymentId,
      receiptNumber,
      reconciledAt: admin.firestore.FieldValue.serverTimestamp(),
      reconciledBy: actorId,
    });
    if (lockedStkRequestId && lockedContributionId) {
      transaction.update(db().doc(`kcb_stk_requests/${lockedStkRequestId}`), {
        status: 'reconciled',
        reconciledAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      transaction.set(
        stkContributionLockRef(memberId, lockedContributionId),
        {
          requestId: lockedStkRequestId,
          status: 'reconciled',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    transaction.create(
      db().doc(`audit_events/${requestId}`),
      validateDocumentWrite(
        auditEventDocumentSchema,
        {
          requestId,
          actorId,
          action: 'kcb_payment.reconciled',
          memberId,
          targetId: paymentId,
          changes: {
            providerTransactionId,
            amount: notification.amount,
            allocations,
            unallocatedAmount: allocationResult.unallocatedAmount,
            receiptNumber,
          },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        `audit_events/${requestId}`,
      ),
    );
    const notificationEventPath = `notification_events/payment-reconciled-${paymentId}`;
    transaction.create(
      db().doc(notificationEventPath),
      validateDocumentWrite(
        notificationEventDocumentSchema,
        {
          type: 'payment.reconciled',
          memberId,
          paymentId,
          receiptNumber,
          amount: notification.amount,
          source: 'kcb_buni',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        notificationEventPath,
      ),
    );
    return { requestId, paymentId, receiptNumber, duplicate: false };
  });
});

export const allocateKcbPaymentCredit = onCall(async (request) => {
  const actorId = requireAdministrator(request.auth);
  const data = request.data as Data;
  const requestId = requiredString(data, 'requestId');
  const providerTransactionId = requiredString(data, 'providerTransactionId');
  const allocations = requiredAllocations(data.allocations);
  if (!allocations.length) {
    throw new HttpsError('invalid-argument', 'Add at least one allocation.');
  }
  return db().runTransaction(async (transaction) => {
    const commandRef = db().doc(`financial_commands/${requestId}`);
    const notificationRef = db().doc(`kcb_payment_notifications/${providerTransactionId}`);
    const [command, notificationSnapshot] = await Promise.all([
      transaction.get(commandRef), transaction.get(notificationRef),
    ]);
    if (command.exists) return { requestId, duplicate: true };
    if (!notificationSnapshot.exists) throw new HttpsError('not-found', 'KCB payment not found.');
    const notification = kcbPaymentNotificationData(notificationSnapshot);
    if (notification.status !== 'reconciled' || !notification.memberId || !notification.paymentId) {
      throw new HttpsError('failed-precondition', 'Payment is not available for credit allocation.');
    }
    const paymentRef = db().doc(`members/${notification.memberId}/payments/${notification.paymentId}`);
    const memberRef = db().doc(`members/${notification.memberId}`);
    const contributionRefs = allocations.map(({ contributionId }) =>
      db().doc(`members/${notification.memberId}/contributions/${contributionId}`));
    const lockRefs = allocations.map(({ contributionId }) =>
      stkContributionLockRef(String(notification.memberId), contributionId));
    const relatedSnapshots = await Promise.all([
      transaction.get(paymentRef),
      transaction.get(memberRef),
      ...contributionRefs.map((ref) => transaction.get(ref)),
      ...lockRefs.map((ref) => transaction.get(ref)),
    ]);
    const [paymentSnapshot, memberSnapshot] = relatedSnapshots;
    const contributionSnapshots = relatedSnapshots.slice(
      2,
      2 + contributionRefs.length,
    );
    const lockSnapshots = relatedSnapshots.slice(2 + contributionRefs.length);
    if (!paymentSnapshot.exists || !memberSnapshot.exists || contributionSnapshots.some((item) => !item.exists)) {
      throw new HttpsError('not-found', 'Payment or contribution not found.');
    }
    assertNoCompetingStkLocks(lockSnapshots);
    const payment = paymentData(paymentSnapshot);
    const derivedAvailable = unallocatedPaymentAmount(
      Number(payment.amount),
      Number(payment.contribution_amount),
      notification.unallocatedAmount,
    );
    const member = memberData(memberSnapshot);
    const creditWasReserved = payment.credit_reserved === true;
    const outstandingTotal = creditWasReserved
      ? 0
      : recoverableOutstandingBalance(
        (await transaction.get(
          db().collection(`members/${notification.memberId}/contributions`),
        )).docs.map((snapshot) => snapshot.data()),
      );
    const available = creditWasReserved
      ? derivedAvailable
      : reservableLegacyKcbCredit(
        derivedAvailable,
        Number(member.balance),
        outstandingTotal,
        Number(member.reservedKcbCredit ?? 0),
      );
    const existingAllocations = paymentAllocations(payment);
    const existingContributionIds = new Set(existingAllocations.map((item) => item.contributionId));
    if (allocations.some((item) => existingContributionIds.has(item.contributionId))) {
      throw new HttpsError(
        'invalid-argument',
        'This receipt already has an allocation for that contribution.',
      );
    }
    const outstanding = Object.fromEntries(contributionSnapshots.map((snapshot, index) => [
      allocations[index].contributionId, Number(contributionData(snapshot).balance),
    ]));
    let result: ReturnType<typeof validatePaymentAllocations>;
    try {
      result = validatePaymentAllocations(available, allocations, outstanding);
    } catch (cause) {
      throw new HttpsError('invalid-argument', (cause as Error).message);
    }
    const storedAllocations = allocations.map((item) => ({
      contribution_id: item.contributionId, amount: item.amount,
    }));
    const storedExistingAllocations = existingAllocations.map((item) => ({
      contribution_id: item.contributionId, amount: item.amount,
    }));
    allocations.forEach((allocation, index) => {
      const remaining = outstanding[allocation.contributionId] - allocation.amount;
      const allocationPayment = {
        ...payment,
        contribution_id: allocation.contributionId,
        contribution_amount: allocation.amount,
        payment_type: 'contribution',
      };
      transaction.update(contributionRefs[index], {
        payments: admin.firestore.FieldValue.arrayUnion(allocationPayment),
        balance: remaining,
        paid: remaining === 0 ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.PARTIAL,
      });
      transaction.set(db().doc(`monthly_stats/${allocation.contributionId}`), {
        contribution: admin.firestore.FieldValue.increment(allocation.amount),
        month: allocation.contributionId,
      }, { merge: true });
    });
    transaction.create(commandRef, {
      type: 'allocateKcbPaymentCredit', actorId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.update(paymentRef, {
      allocations: admin.firestore.FieldValue.arrayUnion(
        ...storedExistingAllocations, ...storedAllocations,
      ),
      contribution_amount: admin.firestore.FieldValue.increment(result.allocatedAmount),
      contribution_id: payment.contribution_id || allocations[0].contributionId,
      payment_type: 'contribution',
      unallocated_amount: result.unallocatedAmount,
      credit_reserved: true,
    });
    transaction.update(memberRef, {
      contributionBalance: admin.firestore.FieldValue.increment(result.allocatedAmount),
      reservedKcbCredit: admin.firestore.FieldValue.increment(
        creditWasReserved ? -result.allocatedAmount : result.unallocatedAmount,
      ),
    });
    transaction.update(notificationRef, {
      allocations: admin.firestore.FieldValue.arrayUnion(...allocations),
      unallocatedAmount: result.unallocatedAmount,
      creditReserved: true,
      creditAllocatedAt: admin.firestore.FieldValue.serverTimestamp(),
      creditAllocatedBy: actorId,
    });
    transaction.create(db().doc(`audit_events/${requestId}`), validateDocumentWrite(
      auditEventDocumentSchema,
      {
        requestId, actorId, action: 'kcb_payment.credit_allocated',
        memberId: notification.memberId, targetId: notification.paymentId,
        changes: { providerTransactionId, allocations, unallocatedAmount: result.unallocatedAmount },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      `audit_events/${requestId}`,
    ));
    return { requestId, allocatedAmount: result.allocatedAmount,
      unallocatedAmount: result.unallocatedAmount, duplicate: false };
  });
});

export const rejectKcbPayment = onCall(async (request) => {
  const actorId = requireAdministrator(request.auth);
  const data = request.data as Data;
  const requestId = requiredString(data, 'requestId');
  const providerTransactionId = requiredString(data, 'providerTransactionId');
  const reason = requiredString(data, 'reason');
  return db().runTransaction(async (transaction) => {
    const commandRef = db().doc(`financial_commands/${requestId}`);
    const notificationRef = db().doc(
      `kcb_payment_notifications/${providerTransactionId}`,
    );
    const [command, notification] = await Promise.all([
      transaction.get(commandRef),
      transaction.get(notificationRef),
    ]);
    if (command.exists) return { requestId, duplicate: true };
    if (!notification.exists) {
      throw new HttpsError('not-found', 'KCB payment notification not found.');
    }
    const notificationData = kcbPaymentNotificationData(notification);
    if (notificationData.status !== 'unresolved') {
      throw new HttpsError(
        'failed-precondition',
        'Only unresolved notifications can be rejected.',
      );
    }
    let linkedStkRequest:
      | {
        ref: FirebaseFirestore.DocumentReference;
        data: ReturnType<typeof kcbStkRequestData>;
        lockRef: FirebaseFirestore.DocumentReference;
        ownsLock: boolean;
      }
      | undefined;
    if (notificationData.source === 'stk_callback') {
      const stkRequestId =
        typeof notificationData.stkRequestId === 'string'
          ? notificationData.stkRequestId
          : '';
      if (!stkRequestId) {
        throw new HttpsError(
          'failed-precondition',
          'This STK notification is missing its linked request.',
        );
      }
      const stkRequestRef = db().doc(`kcb_stk_requests/${stkRequestId}`);
      const stkRequestSnapshot = await transaction.get(stkRequestRef);
      if (!stkRequestSnapshot.exists) {
        throw new HttpsError(
          'failed-precondition',
          'The linked STK request no longer exists.',
        );
      }
      const stkRequest = kcbStkRequestData(stkRequestSnapshot);
      const lockRef = stkContributionLockRef(
        stkRequest.memberId,
        stkRequest.contributionId,
      );
      const lockSnapshot = await transaction.get(lockRef);
      linkedStkRequest = {
        ref: stkRequestRef,
        data: stkRequest,
        lockRef,
        ownsLock: lockSnapshot.data()?.requestId === stkRequestId,
      };
    }
    transaction.create(commandRef, {
      type: 'rejectKcbPayment',
      actorId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.update(notificationRef, {
      status: 'rejected',
      rejectionReason: reason,
      rejectedBy: actorId,
      rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (linkedStkRequest) {
      transaction.update(linkedStkRequest.ref, {
        status: 'rejected',
        rejectionReason: reason,
        rejectedBy: actorId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      if (linkedStkRequest.ownsLock) {
        transaction.update(linkedStkRequest.lockRef, {
          status: 'rejected',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }
    transaction.create(
      db().doc(`audit_events/${requestId}`),
      validateDocumentWrite(
        auditEventDocumentSchema,
        {
          requestId,
          actorId,
          action: 'kcb_payment.rejected',
          memberId: linkedStkRequest?.data.memberId ?? '',
          targetId: providerTransactionId,
          changes: { reason },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        `audit_events/${requestId}`,
      ),
    );
    return { requestId, duplicate: false };
  });
});

export const resolveKcbStkUnknownOutcome = onCall(async (request) => {
  const actorId = requireAdministrator(request.auth);
  const data = request.data as Data;
  const commandId = requiredString(data, 'requestId');
  const stkRequestId = requiredString(data, 'stkRequestId');
  const reason = requiredString(data, 'reason');
  return db().runTransaction(async (transaction) => {
    const commandRef = db().doc(`financial_commands/${commandId}`);
    const stkRequestRef = db().doc(`kcb_stk_requests/${stkRequestId}`);
    const [command, stkRequestSnapshot] = await Promise.all([
      transaction.get(commandRef),
      transaction.get(stkRequestRef),
    ]);
    if (command.exists) return { requestId: commandId, duplicate: true };
    if (!stkRequestSnapshot.exists) {
      throw new HttpsError('not-found', 'STK request not found.');
    }
    const stkRequest = kcbStkRequestData(stkRequestSnapshot);
    if (
      !isManuallyResolvableStkUnknownOutcome({
        status: stkRequest.status,
        failureCategory: stkRequest.failureCategory,
        resultCode: stkRequest.resultCode,
      })
    ) {
      throw new HttpsError(
        'failed-precondition',
        'Only an ambiguous provider dispatch can be marked as failed manually.',
      );
    }
    const dispatchStartedAtMillis = timestampMillis(
      stkRequest.dispatchStartedAt,
    );
    const dispatchExpiresAtMillis =
      timestampMillis(stkRequest.dispatchExpiresAt) ??
      (dispatchStartedAtMillis === undefined
        ? undefined
        : dispatchStartedAtMillis + STK_DISPATCH_RESOLUTION_DELAY_MS);
    if (
      stkRequest.status === 'dispatching' &&
      !isStkInitiationLeaseExpired(dispatchExpiresAtMillis, Date.now())
    ) {
      throw new HttpsError(
        'failed-precondition',
        'This dispatch is still within its provider response window.',
      );
    }
    const lockRef = stkContributionLockRef(
      stkRequest.memberId,
      stkRequest.contributionId,
    );
    const lock = await transaction.get(lockRef);
    const lockData = lock.data();
    const ownsLock = ownsExpectedStkTransition({
      requestStatus: stkRequest.status,
      expectedStatus: stkRequest.status,
      requestId: stkRequestId,
      lockRequestId: lockData?.requestId,
      lockStatus: lockData?.status,
    });
    if (!ownsLock) {
      throw new HttpsError(
        'failed-precondition',
        'This STK request no longer owns the matching contribution lock.',
      );
    }
    transaction.create(commandRef, {
      type: 'resolveKcbStkUnknownOutcome',
      actorId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.update(stkRequestRef, {
      status: 'failed',
      failureCategory: 'provider_outcome_verified_not_accepted',
      resolutionReason: reason,
      resolvedBy: actorId,
      resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (ownsLock) {
      transaction.update(lockRef, {
        status: 'failed',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    transaction.create(
      db().doc(`audit_events/${commandId}`),
      validateDocumentWrite(
        auditEventDocumentSchema,
        {
          requestId: commandId,
          actorId,
          action: 'kcb_stk.unknown_outcome_resolved',
          memberId: stkRequest.memberId,
          targetId: stkRequestId,
          changes: { reason, status: 'failed', ownsLock },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        `audit_events/${commandId}`,
      ),
    );
    return { requestId: commandId, stkRequestId, duplicate: false };
  });
});

const bearerToken = async () => {
  const authorization = Buffer.from(
    `${KCB_CONSUMER_KEY.value()}:${KCB_CONSUMER_SECRET.value()}`,
  ).toString('base64');
  const response = await fetch(KCB_TOKEN_URL.value(), {
    method: 'POST',
    headers: { Authorization: `Basic ${authorization}` },
  });
  if (!response.ok) {
    throw new Error(`KCB token request failed with status ${response.status}.`);
  }
  const body = (await response.json()) as { access_token?: unknown };
  if (typeof body.access_token !== 'string' || !body.access_token) {
    throw new Error('KCB token response did not include an access token.');
  }
  return body.access_token;
};

export const requestKcbStkPush = onCall(
  { secrets: [KCB_CONSUMER_KEY, KCB_CONSUMER_SECRET, KCB_STK_CALLBACK_TOKEN] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in is required.');
    }
    const requesterId = request.auth.uid;
    const data = request.data as Data;
    const requestId = requiredString(data, 'requestId');
    const memberId = requiredString(data, 'memberId');
    const contributionId = requiredString(data, 'contributionId');
    if (
      request.auth.uid !== memberId &&
      request.auth.token.role !== 'administrator'
    ) {
      throw new HttpsError(
        'permission-denied',
        'You cannot request payment for this member.',
      );
    }
    const amount = Number(data.amount);
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new HttpsError(
        'invalid-argument',
        'amount must be a positive whole number.',
      );
    }
    const callbackUrl = new URL(KCB_STK_CALLBACK_URL.value());
    if (callbackUrl.protocol !== 'https:') {
      throw new HttpsError(
        'failed-precondition',
        'KCB_STK_CALLBACK_URL must be a public HTTPS URL.',
      );
    }
    callbackUrl.searchParams.set('token', KCB_STK_CALLBACK_TOKEN.value());
    const requestRef = db().doc(`kcb_stk_requests/${requestId}`);
    const invoiceNumber =
      `TMB${randomUUID().replace(/-/g, '').slice(0, 9)}`.toUpperCase();
    const messageId = randomUUID().replace(/-/g, '').slice(0, 32);
    const memberRef = db().doc(`members/${memberId}`);
    const contributionRef = db().doc(
      `members/${memberId}/contributions/${contributionId}`,
    );
    const lockRef = stkContributionLockRef(memberId, contributionId);
    const contributionStkRequestsQuery = db()
      .collection('kcb_stk_requests')
      .where('contributionId', '==', contributionId);
    const preparation = await db().runTransaction(async (transaction) => {
      const [existing, member, contribution, lock, contributionStkRequests] =
        await Promise.all([
          transaction.get(requestRef),
          transaction.get(memberRef),
          transaction.get(contributionRef),
          transaction.get(lockRef),
          transaction.get(contributionStkRequestsQuery),
        ]);
      const legacyActiveRequest = contributionStkRequests.docs.find((item) => {
        const stored = kcbStkRequestData(item);
        return (
          stored.memberId === memberId &&
          isActiveStkRequestStatus(stored.status)
        );
      });
      const existingLockStatus = lock.data()?.status;
      const hasActiveLock =
        typeof existingLockStatus === 'string' &&
        isActiveStkRequestStatus(existingLockStatus);
      if (!hasActiveLock && legacyActiveRequest) {
        const legacy = kcbStkRequestData(legacyActiveRequest);
        const legacyLeaseExpiresAt =
          legacy.status === 'initiating'
            ? (legacy.leaseExpiresAt ??
              admin.firestore.Timestamp.fromMillis(Date.now() - 1))
            : undefined;
        if (legacy.status === 'initiating' && !legacy.leaseExpiresAt) {
          transaction.update(legacyActiveRequest.ref, {
            leaseExpiresAt: legacyLeaseExpiresAt,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        transaction.set(lockRef, {
          requestId: legacyActiveRequest.id,
          status: legacy.status,
          amount: Number(legacy.amount),
          ...(legacyLeaseExpiresAt
            ? { leaseExpiresAt: legacyLeaseExpiresAt }
            : {}),
          ...(legacy.dispatchExpiresAt
            ? { dispatchExpiresAt: legacy.dispatchExpiresAt }
            : {}),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          backfilledFromLegacyRequest: true,
        });
      }
      if (existing.exists) {
        const stored = kcbStkRequestData(existing);
        if (!isSameStkRequestPayload(stored, {
          memberId,
          contributionId,
          amount,
        })) {
          throw new HttpsError(
            'already-exists',
            'requestId is already used for a different STK payment request.',
          );
        }
        if (isSuccessfulStkDuplicateStatus(stored.status)) {
          return { duplicate: stored };
        }
        if (isRecoverableStkLeaseStatus(stored.status)) {
          const leaseExpired = isStkInitiationLeaseExpired(
            timestampMillis(stored.leaseExpiresAt),
            Date.now(),
          );
          const lockData = lock.data() as { requestId?: unknown } | undefined;
          if (leaseExpired && lockData?.requestId === requestId) {
            const leaseExpiresAt = admin.firestore.Timestamp.fromMillis(
              Date.now() + STK_INITIATION_LEASE_MS,
            );
            transaction.update(requestRef, {
              status: 'initiating',
              leaseExpiresAt,
              retryCount: admin.firestore.FieldValue.increment(1),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            transaction.update(lockRef, {
              status: 'initiating',
              leaseExpiresAt,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            return {
              phone: stored.phone,
              invoiceNumber: stored.invoiceNumber,
              messageId: stored.messageId,
            };
          }
          throw new HttpsError(
            'unavailable',
            'This STK request is still being initiated. Try again shortly.',
          );
        }
        if (
          stored.status === 'dispatching' ||
          stored.status === 'outcome_unknown'
        ) {
          throw new HttpsError(
            'failed-precondition',
            'The provider outcome must be verified by an administrator before another STK request.',
          );
        }
        throw new HttpsError(
          'failed-precondition',
          `The previous STK request ended with status ${stored.status}. Try again.`,
        );
      }
      if (!member.exists || !contribution.exists) {
        throw new HttpsError('not-found', 'Member or contribution not found.');
      }
      if (legacyActiveRequest) {
        return { blockedByLegacyRequestId: legacyActiveRequest.id };
      }
      if (lock.exists) {
        const lockData = lock.data() as { status?: unknown };
        if (
          typeof lockData.status === 'string' &&
          isActiveStkRequestStatus(lockData.status)
        ) {
          throw new HttpsError(
            'already-exists',
            'An STK payment request is already active for this contribution.',
          );
        }
      }
      const memberRecord = memberData(member);
      if (memberRecord.status !== MEMBER_STATUS.ACTIVE) {
        throw new HttpsError(
          'failed-precondition',
          'Only active members can request contribution payments.',
        );
      }
      const contributionRecord = contributionData(contribution);
      if (amount > contributionRecord.balance) {
        throw new HttpsError(
          'invalid-argument',
          'amount exceeds the contribution balance.',
        );
      }
      let phone: string;
      try {
        phone = normalizeKenyanPhone(memberRecord.phonenumber);
      } catch {
        throw new HttpsError(
          'failed-precondition',
          'Member must have a valid Kenyan phone number.',
        );
      }
      const leaseExpiresAt = admin.firestore.Timestamp.fromMillis(
        Date.now() + STK_INITIATION_LEASE_MS,
      );
      transaction.create(requestRef, {
        requestId,
        memberId,
        contributionId,
        amount,
        phone,
        invoiceNumber,
        messageId,
        status: 'initiating',
        leaseExpiresAt,
        retryCount: 0,
        requestedBy: requesterId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      transaction.set(lockRef, {
        requestId,
        status: 'initiating',
        amount,
        leaseExpiresAt,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { phone, invoiceNumber, messageId };
    });
    if ('blockedByLegacyRequestId' in preparation) {
      throw new HttpsError(
        'already-exists',
        'An active legacy STK request was locked for this contribution. Resolve it before requesting another prompt.',
      );
    }
    if ('duplicate' in preparation) {
      return { ...preparation.duplicate, duplicate: true };
    }
    const phone = preparation.phone;
    const preparedInvoiceNumber = preparation.invoiceNumber;
    const preparedMessageId = preparation.messageId;
    let providerDispatchStarted = false;
    let providerMerchantRequestId: string | null = null;
    let providerCheckoutRequestId: string | null = null;
    try {
      const token = await bearerToken();
      await db().runTransaction(async (transaction) => {
        const [stkRequest, lock] = await Promise.all([
          transaction.get(requestRef),
          transaction.get(lockRef),
        ]);
        const stored = kcbStkRequestData(stkRequest);
        if (
          !ownsExpectedStkTransition({
            requestStatus: stored.status,
            expectedStatus: 'initiating',
            requestId,
            lockRequestId: lock.data()?.requestId,
            lockStatus: lock.data()?.status,
          })
        ) {
          throw new HttpsError(
            'failed-precondition',
            'This STK request no longer owns an initiating contribution lock.',
          );
        }
        const dispatchExpiresAt = admin.firestore.Timestamp.fromMillis(
          Date.now() + STK_DISPATCH_RESOLUTION_DELAY_MS,
        );
        transaction.update(requestRef, {
          status: 'dispatching',
          dispatchStartedAt: admin.firestore.FieldValue.serverTimestamp(),
          dispatchExpiresAt,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        transaction.update(lockRef, {
          status: 'dispatching',
          dispatchExpiresAt,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      providerDispatchStarted = true;
      const response = await fetch(KCB_STK_URL.value(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          routeCode: KCB_STK_ROUTE_CODE.value(),
          operation: 'STKPush',
          messageId: preparedMessageId,
        },
        body: JSON.stringify({
          phoneNumber: phone.slice(1),
          amount: String(amount),
          invoiceNumber: preparedInvoiceNumber,
          sharedShortCode: true,
          orgShortCode: KCB_ORG_SHORTCODE.value(),
          orgPassKey: '',
          callbackUrl: callbackUrl.toString(),
          transactionDescription: 'TMBWA payment',
        }),
      });
      const body = (await response.json()) as {
        header?: { statusCode?: unknown; statusDescription?: unknown };
        response?: Record<string, unknown>;
      };
      const accepted =
        response.ok &&
        String(body.header?.statusCode) === '0' &&
        Number(body.response?.ResponseCode) === 0;
      const merchantRequestId =
        typeof body.response?.MerchantRequestID === 'string'
          ? body.response.MerchantRequestID
          : null;
      const checkoutRequestId =
        typeof body.response?.CheckoutRequestID === 'string'
          ? body.response.CheckoutRequestID
          : null;
      providerMerchantRequestId = merchantRequestId;
      providerCheckoutRequestId = checkoutRequestId;
      const providerResponseStatus = accepted
        ? merchantRequestId && checkoutRequestId
          ? 'pending'
          : 'outcome_unknown'
        : 'rejected';
      const responseStored = await db().runTransaction(async (transaction) => {
        const unmatchedRef = checkoutRequestId
          ? db().doc(`kcb_stk_unmatched_callbacks/${checkoutRequestId}`)
          : undefined;
        const [currentRequest, lock, unmatched] = await Promise.all([
          transaction.get(requestRef),
          transaction.get(lockRef),
          ...(unmatchedRef ? [transaction.get(unmatchedRef)] : []),
        ]);
        const current = kcbStkRequestData(currentRequest);
        const lockData = lock.data();
        if (!ownsExpectedStkTransition({
          requestStatus: current.status,
          expectedStatus: 'dispatching',
          requestId,
          lockRequestId: lockData?.requestId,
          lockStatus: lockData?.status,
        })) {
          return false;
        }
        if (
          accepted &&
          merchantRequestId &&
          checkoutRequestId &&
          unmatchedRef &&
          unmatched?.exists &&
          Number.isInteger(Number(unmatched.data()?.resultCode))
        ) {
          const unmatchedData = unmatched.data() as {
            merchantRequestId?: unknown;
            receiptNumber?: unknown;
            amount?: unknown;
            payerPhone?: unknown;
            transactionDate?: unknown;
            resultCode?: unknown;
            resultDescription?: unknown;
          };
          const callbackResultCode = Number(unmatchedData.resultCode);
          if (
            Number.isInteger(callbackResultCode) &&
            callbackResultCode !== 0
          ) {
            const merchantRequestMismatch =
              unmatchedData.merchantRequestId !== merchantRequestId;
            const status = merchantRequestMismatch
              ? 'outcome_unknown'
              : stkFailureStatus(callbackResultCode);
            transaction.update(requestRef, {
              status,
              merchantRequestId,
              checkoutRequestId,
              resultCode: callbackResultCode,
              resultDescription: unmatchedData.resultDescription ?? null,
              ...(merchantRequestMismatch
                ? {
                    callbackFailureReason: 'merchant_request_id_mismatch',
                    mismatchedCallbackReceivedAt:
                      admin.firestore.FieldValue.serverTimestamp(),
                  }
                : {
                    callbackReceivedAt:
                      admin.firestore.FieldValue.serverTimestamp(),
                  }),
              responseCode: body.response?.ResponseCode ?? null,
              responseDescription:
                body.response?.ResponseDescription ??
                body.header?.statusDescription ??
                null,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            transaction.update(lockRef, {
              status,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            transaction.update(unmatchedRef, {
              status: merchantRequestMismatch ? 'quarantined' : 'correlated',
              requestId,
              ...(merchantRequestMismatch
                ? {
                    quarantinedAt:
                      admin.firestore.FieldValue.serverTimestamp(),
                  }
                : {
                    correlatedAt: admin.firestore.FieldValue.serverTimestamp(),
                  }),
            });
            const callbackMerchantRequestId = String(
              unmatchedData.merchantRequestId ?? '',
            );
            const auditEventId = merchantRequestMismatch
              ? stkCallbackMismatchAuditId(
                checkoutRequestId,
                callbackMerchantRequestId,
              )
              : `stk-callback-${checkoutRequestId}`;
            transaction.create(
              db().doc(`audit_events/${auditEventId}`),
              validateDocumentWrite(
                auditEventDocumentSchema,
                {
                  requestId,
                  actorId: 'system:kcb_callback',
                  action: merchantRequestMismatch
                    ? 'kcb_stk.callback_quarantined'
                    : 'kcb_stk.callback_processed',
                  memberId: current.memberId,
                  targetId: checkoutRequestId,
                  changes: {
                    status,
                    resultCode: callbackResultCode,
                    resultDescription:
                      unmatchedData.resultDescription ?? null,
                    ...(merchantRequestMismatch
                      ? {
                          reason: 'merchant_request_id_mismatch',
                          merchantRequestId: callbackMerchantRequestId,
                        }
                      : {}),
                  },
                  createdAt: admin.firestore.FieldValue.serverTimestamp(),
                },
                `audit_events/${auditEventId}`,
              ),
            );
            return status;
          }
          const receiptNumber = String(unmatchedData.receiptNumber ?? '');
          if (!receiptNumber) {
            throw new HttpsError(
              'data-loss',
              'The unmatched STK callback is missing its receipt number.',
            );
          }
          const notificationRef = db().doc(
            `kcb_payment_notifications/${receiptNumber}`,
          );
          const notification = await transaction.get(notificationRef);
          const notificationData = notification.exists
            ? kcbPaymentNotificationData(notification)
            : undefined;
          const notificationStatus = notificationData?.status;
          const terminalReceiptMatchesRequest =
            notificationStatus && notificationStatus !== 'unresolved'
              ? terminalNotificationMatchesStkRequest({
                notificationStatus,
                notificationMemberId: notificationData?.memberId,
                notificationStkRequestId: notificationData?.stkRequestId,
                allocations: notificationData?.allocations ?? [],
                requestId,
                memberId: current.memberId,
                contributionId: current.contributionId,
                amount: Number(current.amount),
              })
              : undefined;
          const terminalNotificationStatus =
            notificationStatus && notificationStatus !== 'unresolved'
              ? terminalReceiptMatchesRequest
                ? notificationStatus === 'reconciled'
                  ? 'reconciled'
                  : 'rejected'
                : 'outcome_unknown'
              : undefined;
          const callbackMatchesRequest = unmatchedStkCallbackMatchesRequest({
            callbackMerchantRequestId: unmatchedData.merchantRequestId,
            callbackAmount: unmatchedData.amount,
            callbackPhone: unmatchedData.payerPhone,
            requestMerchantRequestId: merchantRequestId,
            requestAmount: Number(current.amount),
            requestPhone: current.phone,
          });
          if (!terminalNotificationStatus) {
            const correlatedNotification = {
              messageId: checkoutRequestId,
              channelCode: 'stk',
              billReference: current.invoiceNumber,
              payerPhone: String(unmatchedData.payerPhone ?? ''),
              amount: Number(unmatchedData.amount),
              transactionDate: String(unmatchedData.transactionDate ?? ''),
              transactionType: 'MPESA_STK',
              suggestedMemberId: current.memberId,
              memberId: current.memberId,
              contributionId: current.contributionId,
              matchReason: callbackMatchesRequest
                ? 'authenticated_stk_request'
                : 'authenticated_stk_request_mismatch',
              source: 'stk_callback',
              provider: 'kcb_buni',
              stkRequestId: requestId,
              requestedAmount: Number(current.amount),
            };
            if (notification.exists) {
              transaction.set(
                notificationRef,
                {
                  ...correlatedNotification,
                  reconciliationWarning: callbackMatchesRequest
                    ? admin.firestore.FieldValue.delete()
                    : 'payment_details_mismatch',
                },
                { merge: true },
              );
            } else {
              transaction.create(
                notificationRef,
                validateDocumentWrite(
                  kcbPaymentNotificationDocumentSchema,
                  {
                    providerTransactionId: receiptNumber,
                    ...correlatedNotification,
                    payerName: '',
                    currency: KCB_CURRENCY.value(),
                    status: 'unresolved',
                    ...(!callbackMatchesRequest
                      ? { reconciliationWarning: 'payment_details_mismatch' }
                      : {}),
                    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
                  },
                  notificationRef.path,
                ),
              );
            }
          }
          const correlatedStatus =
            terminalNotificationStatus ?? 'succeeded_pending_reconciliation';
          transaction.update(requestRef, {
            status: correlatedStatus,
            merchantRequestId,
            checkoutRequestId,
            providerTransactionId: receiptNumber,
            ...(terminalNotificationStatus === 'outcome_unknown' &&
            terminalReceiptMatchesRequest === false
              ? { callbackFailureReason: 'terminal_receipt_linkage_mismatch' }
              : {}),
            responseCode: body.response?.ResponseCode ?? null,
            responseDescription:
              body.response?.ResponseDescription ??
              body.header?.statusDescription ??
              null,
            callbackReceivedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          transaction.update(lockRef, {
            status: correlatedStatus,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          transaction.update(unmatchedRef, {
            status: 'correlated',
            requestId,
            correlatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          transaction.create(
            db().doc(`audit_events/stk-callback-${checkoutRequestId}`),
            validateDocumentWrite(
              auditEventDocumentSchema,
              {
                requestId,
                actorId: 'system:kcb_callback',
                action:
                  correlatedStatus === 'outcome_unknown' ||
                  !callbackMatchesRequest
                    ? 'kcb_stk.callback_quarantined'
                    : 'kcb_stk.callback_processed',
                memberId: current.memberId,
                targetId: checkoutRequestId,
                changes: {
                  status: correlatedStatus,
                  providerTransactionId: receiptNumber,
                  contributionId: current.contributionId,
                  amount: Number(unmatchedData.amount),
                  ...(!callbackMatchesRequest
                    ? { reason: 'payment_details_mismatch' }
                    : terminalReceiptMatchesRequest === false
                      ? { reason: 'terminal_receipt_linkage_mismatch' }
                      : {}),
                },
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              `audit_events/stk-callback-${checkoutRequestId}`,
            ),
          );
          return correlatedStatus;
        }
        if (
          accepted &&
          merchantRequestId &&
          checkoutRequestId &&
          unmatchedRef
        ) {
          transaction.set(
            unmatchedRef,
            {
              requestId,
              merchantRequestId,
              checkoutRequestId,
              status: 'awaiting_callback',
              registeredAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        }
        transaction.update(requestRef, {
          status: providerResponseStatus,
          merchantRequestId,
          checkoutRequestId,
          ...(accepted && providerResponseStatus === 'outcome_unknown'
            ? {
                failureCategory: 'provider_response_missing_correlation_ids',
              }
            : {}),
          responseCode: body.response?.ResponseCode ?? null,
          responseDescription:
            body.response?.ResponseDescription ??
            body.header?.statusDescription ??
            null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        transaction.update(lockRef, {
          status: providerResponseStatus,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return 'stored';
      });
      if (!responseStored) {
        logger.error('Ignored a late KCB STK response after state changed.', {
          requestId,
          accepted,
          merchantRequestId,
          checkoutRequestId,
        });
        throw new HttpsError(
          'aborted',
          'The STK request state changed before the provider response arrived.',
        );
      }
      if (
        responseStored !== 'stored' &&
        responseStored !== 'succeeded_pending_reconciliation' &&
        responseStored !== 'reconciled'
      ) {
        throw new HttpsError(
          'failed-precondition',
          'KCB reported that the STK request did not complete.',
        );
      }
      if (!accepted || !merchantRequestId || !checkoutRequestId) {
        throw new HttpsError(
          'failed-precondition',
          'KCB did not return a complete accepted STK response.',
        );
      }
      return {
        requestId,
        status: responseStored === 'stored' ? 'pending' : responseStored,
        merchantRequestId,
        checkoutRequestId,
        duplicate: false,
      };
    } catch (error) {
      const failureStatus =
        error instanceof HttpsError
          ? 'rejected'
          : providerDispatchStarted
            ? 'outcome_unknown'
            : 'failed';
      const recoveryLeaseExpiresAt =
        failureStatus === 'outcome_unknown'
          ? admin.firestore.Timestamp.fromMillis(
            Date.now() + STK_INITIATION_LEASE_MS,
          )
          : undefined;
      const expectedStatus = providerDispatchStarted
        ? 'dispatching'
        : 'initiating';
      const failureStored = await db().runTransaction(async (transaction) => {
        const [currentRequest, lock] = await Promise.all([
          transaction.get(requestRef),
          transaction.get(lockRef),
        ]);
        const current = kcbStkRequestData(currentRequest);
        const lockData = lock.data();
        if (!ownsExpectedStkTransition({
          requestStatus: current.status,
          expectedStatus,
          requestId,
          lockRequestId: lockData?.requestId,
          lockStatus: lockData?.status,
        })) {
          return false;
        }
        transaction.update(requestRef, {
          status: failureStatus,
          ...(recoveryLeaseExpiresAt
            ? { leaseExpiresAt: recoveryLeaseExpiresAt }
            : {}),
          ...(providerMerchantRequestId
            ? { merchantRequestId: providerMerchantRequestId }
            : {}),
          ...(providerCheckoutRequestId
            ? { checkoutRequestId: providerCheckoutRequestId }
            : {}),
          failureCategory:
            error instanceof HttpsError
              ? 'provider_rejected'
              : providerDispatchStarted
                ? 'provider_outcome_unknown'
                : 'provider_unavailable',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        transaction.update(lockRef, {
          status: failureStatus,
          ...(recoveryLeaseExpiresAt
            ? { leaseExpiresAt: recoveryLeaseExpiresAt }
            : {}),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return true;
      });
      if (!failureStored) {
        logger.warn('Ignored a stale KCB STK failure after state changed.', {
          requestId,
          expectedStatus,
        });
      }
      if (error instanceof HttpsError) throw error;
      logger.error('KCB STK request failed.', {
        requestId,
        reason: (error as Error).message,
      });
      throw new HttpsError(
        'unavailable',
        'KCB payment request is temporarily unavailable.',
      );
    }
  },
);

export const kcbStkCallback = onRequest(
  { secrets: [KCB_STK_CALLBACK_TOKEN] },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).send('Method not allowed.');
      return;
    }
    const suppliedToken =
      typeof request.query.token === 'string' ? request.query.token : '';
    if (!secureTokenMatches(suppliedToken, KCB_STK_CALLBACK_TOKEN.value())) {
      logger.warn('Rejected unauthenticated KCB STK callback.');
      response
        .status(401)
        .json({ ResultCode: 1, ResultDesc: 'Unauthorized callback' });
      return;
    }
    try {
      const callback = parseStkCallback(request.body);
      const unmatchedRef = db().doc(
        `kcb_stk_unmatched_callbacks/${callback.checkoutRequestId}`,
      );
      const matches = await db()
        .collection('kcb_stk_requests')
        .where('checkoutRequestId', '==', callback.checkoutRequestId)
        .limit(1)
        .get();
      let requestRef = matches.empty ? undefined : matches.docs[0].ref;
      let orphanedDispatchRequestId: string | undefined;
      if (!requestRef && callback.resultCode === 0) {
        const dispatchingRequests = await db()
          .collection('kcb_stk_requests')
          .where('status', '==', 'dispatching')
          .get();
        const candidates = dispatchingRequests.docs.filter((item) => {
          const stored = kcbStkRequestData(item);
          return stkPaymentMatchesPendingRequest({
            callbackAmount: callback.amount,
            pendingAmount: Number(stored.amount),
            callbackPhone: callback.payerPhone,
            pendingPhone: stored.phone,
            receiptNumber: callback.receiptNumber,
          });
        });
        if (candidates.length === 1) {
          orphanedDispatchRequestId = candidates[0].id;
        }
      }
      if (!requestRef) {
        let linkedRequestId: string | undefined;
        if (callback.resultCode === 0) {
          linkedRequestId = await db().runTransaction(async (transaction) => {
            const unmatched = await transaction.get(unmatchedRef);
            const registeredRequestId = unmatched.data()?.requestId;
            const handshakeRequestId =
              typeof registeredRequestId === 'string'
                ? registeredRequestId
                : orphanedDispatchRequestId;
            transaction.set(
              unmatchedRef,
              {
                merchantRequestId: callback.merchantRequestId,
                checkoutRequestId: callback.checkoutRequestId,
                receiptNumber: callback.receiptNumber,
                amount: callback.amount,
                payerPhone: callback.payerPhone,
                transactionDate: callback.transactionDate,
                resultCode: callback.resultCode,
                resultDescription: callback.resultDescription,
                ...(handshakeRequestId
                  ? { requestId: handshakeRequestId }
                  : {}),
                status:
                  unmatched.data()?.status === 'correlated'
                    ? 'correlated'
                    : 'pending_correlation',
                receivedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true },
            );
            return handshakeRequestId;
          });
          logger.warn('Quarantined unmatched successful KCB STK callback.', {
            checkoutRequestId: callback.checkoutRequestId,
            receiptNumber: callback.receiptNumber,
          });
        } else {
          linkedRequestId = await db().runTransaction(async (transaction) => {
            const unmatched = await transaction.get(unmatchedRef);
            transaction.set(
              unmatchedRef,
              {
                merchantRequestId: callback.merchantRequestId,
                checkoutRequestId: callback.checkoutRequestId,
                resultCode: callback.resultCode,
                resultDescription: callback.resultDescription,
                status:
                  unmatched.data()?.status === 'correlated'
                    ? 'correlated'
                    : 'pending_correlation',
                receivedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true },
            );
            const registeredRequestId = unmatched.data()?.requestId;
            return typeof registeredRequestId === 'string'
              ? registeredRequestId
              : undefined;
          });
          logger.warn('Quarantined unmatched unsuccessful KCB STK callback.', {
            checkoutRequestId: callback.checkoutRequestId,
            resultCode: callback.resultCode,
          });
        }
        if (!linkedRequestId) {
          if (callback.resultCode === 0) {
            response.status(503).json({
              ResultCode: 1,
              ResultDesc: 'Callback stored; request correlation is pending',
            });
            return;
          }
          response.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
          return;
        }
        requestRef = db().doc(`kcb_stk_requests/${linkedRequestId}`);
      }
      const correlatedRequestRef = requestRef;
      if (!correlatedRequestRef) {
        throw new Error('The STK callback request handshake is incomplete.');
      }
      await db().runTransaction(async (transaction) => {
        const snapshot = await transaction.get(correlatedRequestRef);
        const pending = kcbStkRequestData(snapshot);
        if (pending.callbackReceivedAt) return;
        const lockRef = stkContributionLockRef(
          pending.memberId,
          pending.contributionId,
        );
        const lock = await transaction.get(lockRef);
        const lockData = lock.data() as { requestId?: unknown } | undefined;
        const updateOwnedLock = (status: string) => {
          if (lockData?.requestId === pending.requestId) {
            transaction.update(lockRef, {
              status,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }
        };
        const merchantRequestMismatch =
          callback.merchantRequestId !== pending.merchantRequestId;
        if (merchantRequestMismatch && callback.resultCode !== 0) {
          const auditEventId = stkCallbackMismatchAuditId(
            callback.checkoutRequestId,
            callback.merchantRequestId,
          );
          const auditEventRef = db().doc(`audit_events/${auditEventId}`);
          const existingAuditEvent = await transaction.get(auditEventRef);
          transaction.update(correlatedRequestRef, {
            status: 'outcome_unknown',
            resultCode: callback.resultCode,
            resultDescription: callback.resultDescription,
            callbackFailureReason: 'merchant_request_id_mismatch',
            mismatchedCallbackReceivedAt:
              admin.firestore.FieldValue.serverTimestamp(),
          });
          updateOwnedLock('outcome_unknown');
          if (!existingAuditEvent.exists) {
            transaction.create(
              auditEventRef,
              validateDocumentWrite(
                auditEventDocumentSchema,
                {
                  requestId: pending.requestId,
                  actorId: 'system:kcb_callback',
                  action: 'kcb_stk.callback_quarantined',
                  memberId: pending.memberId,
                  targetId: callback.checkoutRequestId,
                  changes: {
                    reason: 'merchant_request_id_mismatch',
                    status: 'outcome_unknown',
                    merchantRequestId: callback.merchantRequestId,
                    checkoutRequestId: callback.checkoutRequestId,
                  },
                  createdAt: admin.firestore.FieldValue.serverTimestamp(),
                },
                `audit_events/${auditEventId}`,
              ),
            );
          }
          return;
        }
        if (callback.resultCode !== 0) {
          const status = stkFailureStatus(callback.resultCode);
          transaction.update(correlatedRequestRef, {
            status,
            resultCode: callback.resultCode,
            resultDescription: callback.resultDescription,
            callbackReceivedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          updateOwnedLock(status);
          transaction.create(
            db().doc(`audit_events/stk-callback-${callback.checkoutRequestId}`),
            validateDocumentWrite(
              auditEventDocumentSchema,
              {
                requestId: pending.requestId,
                actorId: 'system:kcb_callback',
                action: 'kcb_stk.callback_processed',
                memberId: pending.memberId,
                targetId: callback.checkoutRequestId,
                changes: {
                  status,
                  resultCode: callback.resultCode,
                  resultDescription: callback.resultDescription,
                },
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              `audit_events/stk-callback-${callback.checkoutRequestId}`,
            ),
          );
          return;
        }
        if (
          merchantRequestMismatch ||
          !stkPaymentMatchesPendingRequest({
            callbackAmount: callback.amount,
            pendingAmount: Number(pending.amount),
            callbackPhone: callback.payerPhone,
            pendingPhone: pending.phone,
            receiptNumber: callback.receiptNumber,
          })
        ) {
          const hasReconciliationDetails =
            typeof callback.receiptNumber === 'string' &&
            callback.receiptNumber.length > 0 &&
            typeof callback.payerPhone === 'string' &&
            Number.isFinite(callback.amount) &&
            Number(callback.amount) > 0 &&
            typeof callback.transactionDate === 'string';
          let quarantinedStatus = hasReconciliationDetails
            ? 'succeeded_pending_reconciliation'
            : 'outcome_unknown';
          if (hasReconciliationDetails) {
            const notificationRef = db().doc(
              `kcb_payment_notifications/${callback.receiptNumber}`,
            );
            const existingNotification = await transaction.get(notificationRef);
            const existingData = existingNotification.exists
              ? kcbPaymentNotificationData(existingNotification)
              : undefined;
            const existingStatus = existingData?.status;
            if (existingStatus && existingStatus !== 'unresolved') {
              quarantinedStatus = terminalNotificationMatchesStkRequest({
                notificationStatus: existingStatus,
                notificationMemberId: existingData?.memberId,
                notificationStkRequestId: existingData?.stkRequestId,
                allocations: existingData?.allocations ?? [],
                requestId: pending.requestId,
                memberId: pending.memberId,
                contributionId: pending.contributionId,
                amount: Number(pending.amount),
              })
                ? existingStatus === 'reconciled'
                  ? 'reconciled'
                  : 'rejected'
                : 'outcome_unknown';
            }
            const quarantinedNotification = {
              providerTransactionId: callback.receiptNumber,
              messageId: callback.checkoutRequestId,
              channelCode: 'stk',
              billReference: pending.invoiceNumber,
              payerPhone: callback.payerPhone,
              payerName: '',
              amount: callback.amount,
              currency: KCB_CURRENCY.value(),
              transactionDate: callback.transactionDate,
              transactionType: 'MPESA_STK',
              status: 'unresolved',
              suggestedMemberId: pending.memberId,
              memberId: pending.memberId,
              contributionId: pending.contributionId,
              matchReason: 'authenticated_stk_request_mismatch',
              provider: 'kcb_buni',
              source: 'stk_callback',
              stkRequestId: snapshot.id,
              requestedAmount: Number(pending.amount),
              reconciliationWarning: merchantRequestMismatch
                ? 'merchant_request_id_mismatch'
                : 'payment_details_mismatch',
            };
            if (existingNotification.exists && existingStatus === 'unresolved') {
              transaction.set(
                notificationRef,
                quarantinedNotification,
                { merge: true },
              );
            } else if (!existingNotification.exists) {
              transaction.create(
                notificationRef,
                validateDocumentWrite(
                  kcbPaymentNotificationDocumentSchema,
                  {
                    ...quarantinedNotification,
                    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
                  },
                  notificationRef.path,
                ),
              );
            }
          }
          transaction.update(correlatedRequestRef, {
            status: quarantinedStatus,
            ...(callback.receiptNumber
              ? { providerTransactionId: callback.receiptNumber }
              : {}),
            resultCode: callback.resultCode,
            resultDescription: callback.resultDescription,
            callbackFailureReason: merchantRequestMismatch
              ? 'merchant_request_id_mismatch'
              : 'payment_details_mismatch',
            callbackReceivedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          updateOwnedLock(quarantinedStatus);
          transaction.create(
            db().doc(`audit_events/stk-callback-${callback.checkoutRequestId}`),
            validateDocumentWrite(
              auditEventDocumentSchema,
              {
                requestId: pending.requestId,
                actorId: 'system:kcb_callback',
                action: 'kcb_stk.callback_quarantined',
                memberId: pending.memberId,
                targetId: callback.checkoutRequestId,
                changes: {
                  reason: merchantRequestMismatch
                    ? 'merchant_request_id_mismatch'
                    : 'payment_details_mismatch',
                  expectedAmount: pending.amount,
                  callbackAmount: callback.amount ?? null,
                  expectedPhone: pending.phone,
                  callbackPhone: callback.payerPhone ?? null,
                  status: quarantinedStatus,
                },
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              `audit_events/stk-callback-${callback.checkoutRequestId}`,
            ),
          );
          return;
        }
        const notificationRef = db().doc(
          `kcb_payment_notifications/${callback.receiptNumber}`,
        );
        const existingNotification = await transaction.get(notificationRef);
        if (existingNotification.exists) {
          const existingData = kcbPaymentNotificationData(existingNotification);
          const existingStatus = existingData.status;
          if (existingStatus !== 'unresolved') {
            const terminalLinkageMatches =
              terminalNotificationMatchesStkRequest({
                notificationStatus: existingStatus,
                notificationMemberId: existingData.memberId,
                notificationStkRequestId: existingData.stkRequestId,
                allocations: existingData.allocations,
                requestId: pending.requestId,
                memberId: pending.memberId,
                contributionId: pending.contributionId,
                amount: Number(pending.amount),
              });
            const terminalStatus =
              terminalLinkageMatches
                ? existingStatus === 'reconciled'
                  ? 'reconciled'
                  : 'rejected'
                : 'outcome_unknown';
            transaction.update(correlatedRequestRef, {
              status: terminalStatus,
              providerTransactionId: callback.receiptNumber,
              resultCode: callback.resultCode,
              resultDescription: callback.resultDescription,
              ...(!terminalLinkageMatches
                ? { callbackFailureReason: 'terminal_receipt_linkage_mismatch' }
                : {}),
              callbackReceivedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            updateOwnedLock(terminalStatus);
            if (!terminalLinkageMatches) {
              transaction.create(
                db().doc(
                  `audit_events/stk-callback-${callback.checkoutRequestId}`,
                ),
                validateDocumentWrite(
                  auditEventDocumentSchema,
                  {
                    requestId: pending.requestId,
                    actorId: 'system:kcb_callback',
                    action: 'kcb_stk.callback_quarantined',
                    memberId: pending.memberId,
                    targetId: callback.checkoutRequestId,
                    changes: {
                      reason: 'terminal_receipt_linkage_mismatch',
                      receiptStatus: existingStatus,
                      receiptMemberId: existingData.memberId ?? null,
                      receiptAllocations: existingData.allocations,
                      expectedContributionId: pending.contributionId,
                    },
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                  },
                  `audit_events/stk-callback-${callback.checkoutRequestId}`,
                ),
              );
            }
            return;
          }
          transaction.set(
            notificationRef,
            {
              messageId: callback.checkoutRequestId,
              channelCode: 'stk',
              billReference: pending.invoiceNumber,
              payerPhone: callback.payerPhone,
              amount: callback.amount,
              transactionDate: callback.transactionDate,
              transactionType: 'MPESA_STK',
              suggestedMemberId: pending.memberId,
              memberId: pending.memberId,
              contributionId: pending.contributionId,
              matchReason: 'authenticated_stk_request',
              provider: 'kcb_buni',
              source: 'stk_callback',
              stkRequestId: snapshot.id,
              requestedAmount: Number(pending.amount),
            },
            { merge: true },
          );
        } else {
          transaction.create(
            notificationRef,
            validateDocumentWrite(
              kcbPaymentNotificationDocumentSchema,
              {
                providerTransactionId: callback.receiptNumber,
                messageId: callback.checkoutRequestId,
                channelCode: 'stk',
                billReference: pending.invoiceNumber,
                payerPhone: callback.payerPhone,
                payerName: '',
                amount: callback.amount,
                currency: KCB_CURRENCY.value(),
                transactionDate: callback.transactionDate,
                transactionType: 'MPESA_STK',
                status: 'unresolved',
                suggestedMemberId: pending.memberId,
                memberId: pending.memberId,
                contributionId: pending.contributionId,
                matchReason: 'authenticated_stk_request',
                provider: 'kcb_buni',
                source: 'stk_callback',
                stkRequestId: snapshot.id,
                requestedAmount: Number(pending.amount),
                receivedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              notificationRef.path,
            ),
          );
        }
        transaction.update(correlatedRequestRef, {
          status: 'succeeded_pending_reconciliation',
          providerTransactionId: callback.receiptNumber,
          resultCode: callback.resultCode,
          resultDescription: callback.resultDescription,
          callbackReceivedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        updateOwnedLock('succeeded_pending_reconciliation');
        transaction.create(
          db().doc(`audit_events/stk-callback-${callback.checkoutRequestId}`),
          validateDocumentWrite(
            auditEventDocumentSchema,
            {
              requestId: pending.requestId,
              actorId: 'system:kcb_callback',
              action: 'kcb_stk.callback_processed',
              memberId: pending.memberId,
              targetId: callback.checkoutRequestId,
              changes: {
                status: 'succeeded_pending_reconciliation',
                providerTransactionId: callback.receiptNumber,
                contributionId: pending.contributionId,
                amount: callback.amount,
              },
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            `audit_events/stk-callback-${callback.checkoutRequestId}`,
          ),
        );
      });
      response.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
    } catch (error) {
      logger.warn('Rejected invalid KCB STK callback.', {
        reason: (error as Error).message,
      });
      response
        .status(400)
        .json({ ResultCode: 1, ResultDesc: 'Invalid callback' });
    }
  },
);
