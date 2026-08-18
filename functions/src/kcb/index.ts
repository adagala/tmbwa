import * as admin from 'firebase-admin';
import { randomUUID } from 'crypto';
import { defineSecret, defineString } from 'firebase-functions/params';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import {
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
  normalizeKenyanPhone,
  parseKcbTransactionDate,
  parseStkCallback,
  parseTillNotification,
  permitsUnsignedSandboxNotification,
  secureTokenMatches,
  verifyKcbSignature,
} from './domain';

type Data = Record<string, unknown>;

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
    const [command, notificationSnapshot, memberSnapshot, ...contributionSnapshots] =
      await Promise.all([
        transaction.get(commandRef),
        transaction.get(notificationRef),
        transaction.get(memberRef),
        ...contributionRefs.map((ref) => transaction.get(ref)),
      ]);
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

    const member = memberData(memberSnapshot);
    const contributions = contributionSnapshots.map(contributionData);
    const outstanding = Object.fromEntries(contributions.map((item, index) => [
      allocations[index].contributionId,
      Number(item.balance),
    ]));
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
    const allContributionsQuery = db().collection(`members/${notification.memberId}/contributions`);
    const contributionRefs = allocations.map(({ contributionId }) =>
      db().doc(`members/${notification.memberId}/contributions/${contributionId}`));
    const [paymentSnapshot, memberSnapshot, allContributionsSnapshot,
      ...contributionSnapshots] = await Promise.all([
      transaction.get(paymentRef),
      transaction.get(memberRef),
      transaction.get(allContributionsQuery),
      ...contributionRefs.map((ref) => transaction.get(ref)),
    ]);
    if (!paymentSnapshot.exists || !memberSnapshot.exists || contributionSnapshots.some((item) => !item.exists)) {
      throw new HttpsError('not-found', 'Payment or contribution not found.');
    }
    const payment = paymentData(paymentSnapshot);
    const derivedAvailable = unallocatedPaymentAmount(
      Number(payment.amount),
      Number(payment.contribution_amount),
      notification.unallocatedAmount,
    );
    const member = memberData(memberSnapshot);
    const creditWasReserved = payment.credit_reserved === true;
    const outstandingTotal = allContributionsSnapshot.docs.reduce(
      (sum, snapshot) => sum + Math.max(Number(contributionData(snapshot).balance), 0), 0,
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
    if (kcbPaymentNotificationData(notification).status !== 'unresolved') {
      throw new HttpsError(
        'failed-precondition',
        'Only unresolved notifications can be rejected.',
      );
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
    transaction.create(
      db().doc(`audit_events/${requestId}`),
      validateDocumentWrite(
        auditEventDocumentSchema,
        {
          requestId,
          actorId,
          action: 'kcb_payment.rejected',
          memberId: '',
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
    const existing = await requestRef.get();
    if (existing.exists) {
      return { ...kcbStkRequestData(existing), duplicate: true };
    }

    const [member, contribution] = await Promise.all([
      db().doc(`members/${memberId}`).get(),
      db().doc(`members/${memberId}/contributions/${contributionId}`).get(),
    ]);
    if (!member.exists || !contribution.exists) {
      throw new HttpsError('not-found', 'Member or contribution not found.');
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
      phone = normalizeKenyanPhone(memberData(member).phonenumber);
    } catch {
      throw new HttpsError(
        'failed-precondition',
        'Member must have a valid Kenyan phone number.',
      );
    }
    const invoiceNumber =
      `TMB${randomUUID().replace(/-/g, '').slice(0, 9)}`.toUpperCase();
    const messageId = randomUUID().replace(/-/g, '').slice(0, 32);

    await requestRef.create({
      requestId,
      memberId,
      contributionId,
      amount,
      phone,
      invoiceNumber,
      messageId,
      status: 'initiating',
      requestedBy: request.auth.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    try {
      const token = await bearerToken();
      const response = await fetch(KCB_STK_URL.value(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          routeCode: KCB_STK_ROUTE_CODE.value(),
          operation: 'STKPush',
          messageId,
        },
        body: JSON.stringify({
          phoneNumber: phone.slice(1),
          amount: String(amount),
          invoiceNumber,
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
      await requestRef.update({
        status: accepted ? 'pending' : 'rejected',
        merchantRequestId,
        checkoutRequestId,
        responseCode: body.response?.ResponseCode ?? null,
        responseDescription:
          body.response?.ResponseDescription ??
          body.header?.statusDescription ??
          null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      if (!accepted || !checkoutRequestId) {
        throw new HttpsError(
          'failed-precondition',
          'KCB did not accept the STK request.',
        );
      }
      return {
        requestId,
        status: 'pending',
        merchantRequestId,
        checkoutRequestId,
        duplicate: false,
      };
    } catch (error) {
      await requestRef.update({
        status: 'failed',
        failureCategory:
          error instanceof HttpsError
            ? 'provider_rejected'
            : 'provider_unavailable',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
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
      const matches = await db()
        .collection('kcb_stk_requests')
        .where('checkoutRequestId', '==', callback.checkoutRequestId)
        .limit(1)
        .get();
      if (matches.empty) {
        logger.warn('Unmatched KCB STK callback.');
        response.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
        return;
      }
      const requestRef = matches.docs[0].ref;
      await db().runTransaction(async (transaction) => {
        const snapshot = await transaction.get(requestRef);
        const pending = kcbStkRequestData(snapshot);
        if (pending.callbackReceivedAt) return;
        if (callback.merchantRequestId !== pending.merchantRequestId) {
          throw new Error('STK callback correlation mismatch.');
        }
        if (callback.resultCode !== 0) {
          let status = 'failed';
          if (callback.resultCode === 1032) status = 'cancelled';
          if (callback.resultCode === 1037) status = 'timed_out';
          transaction.update(requestRef, {
            status,
            resultCode: callback.resultCode,
            resultDescription: callback.resultDescription,
            callbackReceivedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          return;
        }
        if (
          callback.amount !== Number(pending.amount) ||
          callback.payerPhone !== pending.phone ||
          !callback.receiptNumber
        ) {
          throw new Error(
            'STK callback payment details do not match the pending request.',
          );
        }
        const notificationRef = db().doc(
          `kcb_payment_notifications/${callback.receiptNumber}`,
        );
        const existingNotification = await transaction.get(notificationRef);
        if (!existingNotification.exists) {
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
                matchReason: 'authenticated_stk_request',
                provider: 'kcb_buni',
                source: 'stk_callback',
                stkRequestId: snapshot.id,
                receivedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              notificationRef.path,
            ),
          );
        }
        transaction.update(requestRef, {
          status: 'succeeded_pending_reconciliation',
          providerTransactionId: callback.receiptNumber,
          resultCode: callback.resultCode,
          resultDescription: callback.resultDescription,
          callbackReceivedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
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
