import * as admin from 'firebase-admin';
import { randomUUID } from 'crypto';
import { defineSecret, defineString } from 'firebase-functions/params';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { PAYMENT_STATUS } from '../types';
import { applyPayment } from '../financial/domain';
import { acknowledgement, normalizeKenyanPhone, parseStkCallback, parseTillNotification, verifyKcbSignature } from './domain';

type Data = Record<string, unknown>;

const publicKey = defineSecret('KCB_PUBLIC_KEY');
const expectedReference = defineString('KCB_SHARED_REFERENCE', { default: '7969138' });
const expectedCurrency = defineString('KCB_CURRENCY', { default: 'KES' });
const consumerKey = defineSecret('KCB_CONSUMER_KEY');
const consumerSecret = defineSecret('KCB_CONSUMER_SECRET');
const tokenUrl = defineString('KCB_TOKEN_URL', { default: 'https://uat.buni.kcbgroup.com/token?grant_type=client_credentials' });
const stkUrl = defineString('KCB_STK_URL', { default: 'https://uat.buni.kcbgroup.com/mm/api/request/1.0.0/stkpush' });
const stkCallbackUrl = defineString('KCB_STK_CALLBACK_URL');
const orgShortCode = defineString('KCB_ORG_SHORTCODE', { default: '522533' });
const routeCode = defineString('KCB_STK_ROUTE_CODE', { default: '207' });
const db = () => admin.firestore();

const requireAdministrator = (auth: { uid: string; token: Record<string, unknown> } | undefined) => {
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in is required.');
  if (auth.token.role !== 'administrator') throw new HttpsError('permission-denied', 'Administrator access is required.');
  return auth.uid;
};

const requiredString = (data: Data, key: string) => {
  const value = data[key];
  if (typeof value !== 'string' || !value.trim()) throw new HttpsError('invalid-argument', `${key} is required.`);
  return value.trim();
};

export const kcbTillNotification = onRequest({ secrets: [publicKey] }, async (request, response) => {
  if (request.method !== 'POST') {
    response.set('Allow', 'POST').status(405).json({ error: 'Method not allowed.' });
    return;
  }
  const transactionId = randomUUID();
  let messageId: string = transactionId;
  let conversationId: string | undefined;
  try {
    const signature = request.get('signature') || '';
    if (!verifyKcbSignature(request.rawBody, signature, publicKey.value())) {
      logger.warn('Rejected KCB notification with an invalid signature.');
      response.status(401).json(acknowledgement(messageId, undefined, transactionId, false, 'Invalid signature'));
      return;
    }
    const notification = parseTillNotification(request.body);
    messageId = notification.messageId;
    conversationId = notification.conversationId;
    if (notification.currency !== expectedCurrency.value().toUpperCase()) throw new Error('Unsupported currency.');
    if (notification.billReference !== expectedReference.value()) throw new Error('Unexpected bill reference.');

    const notificationRef = db().doc(`kcb_payment_notifications/${notification.providerTransactionId}`);
    await db().runTransaction(async (transaction) => {
      const existing = await transaction.get(notificationRef);
      if (existing.exists) return;
      const matches = await transaction.get(
        db().collection('members').where('verifiedPhoneNormalized', '==', notification.payerPhone).limit(2),
      );
      const suggestedMemberId = matches.size === 1 ? matches.docs[0].id : null;
      transaction.create(notificationRef, {
        ...notification,
        status: 'unresolved',
        suggestedMemberId,
        matchReason: suggestedMemberId ? 'unique_verified_phone' : matches.empty ? 'no_verified_phone_match' : 'ambiguous_phone_match',
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        provider: 'kcb_buni',
        source: 'till_notification',
      });
      transaction.create(db().doc(`kcb_notification_messages/${notification.messageId}`), {
        providerTransactionId: notification.providerTransactionId,
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    response.status(200).json(acknowledgement(messageId, conversationId, transactionId, true, 'Notification received successfully'));
  } catch (error) {
    logger.warn('Rejected invalid KCB notification.', { reason: (error as Error).message });
    response.status(400).json(acknowledgement(messageId, conversationId, transactionId, false, 'Invalid notification'));
  }
});

export const reconcileKcbPayment = onCall(async (request) => {
  const actorId = requireAdministrator(request.auth);
  const data = request.data as Data;
  const requestId = requiredString(data, 'requestId');
  const providerTransactionId = requiredString(data, 'providerTransactionId');
  const memberId = requiredString(data, 'memberId');
  const contributionId = requiredString(data, 'contributionId');

  return db().runTransaction(async (transaction) => {
    const commandRef = db().doc(`financial_commands/${requestId}`);
    const notificationRef = db().doc(`kcb_payment_notifications/${providerTransactionId}`);
    const memberRef = db().doc(`members/${memberId}`);
    const contributionRef = db().doc(`members/${memberId}/contributions/${contributionId}`);
    const [command, notificationSnapshot, memberSnapshot, contributionSnapshot] = await Promise.all([
      transaction.get(commandRef), transaction.get(notificationRef), transaction.get(memberRef), transaction.get(contributionRef),
    ]);
    if (command.exists) return { requestId, duplicate: true };
    if (!notificationSnapshot.exists) throw new HttpsError('not-found', 'KCB payment notification not found.');
    if (!memberSnapshot.exists || !contributionSnapshot.exists) throw new HttpsError('not-found', 'Member or contribution not found.');
    const notification = notificationSnapshot.data()!;
    if (notification.status === 'reconciled') throw new HttpsError('already-exists', 'This provider payment is already reconciled.');
    if (notification.status !== 'unresolved') throw new HttpsError('failed-precondition', 'This notification cannot be reconciled.');

    const member = memberSnapshot.data()!;
    const contribution = contributionSnapshot.data()!;
    const result = applyPayment(Number(notification.amount), Number(contribution.balance ?? 0));
    const paymentId = db().collection(`members/${memberId}/payments`).doc().id;
    const receiptNumber = `TMBWA-${paymentId.toUpperCase()}`;
    const payment = {
      payment_id: paymentId,
      referencenumber: providerTransactionId,
      amount: Number(notification.amount),
      paymentdate: admin.firestore.Timestamp.now(),
      created_at: admin.firestore.Timestamp.now(),
      member_id: memberId,
      contribution_id: contributionId,
      firstname: member.firstname,
      lastname: member.lastname,
      contribution_amount: result.contributionAmount,
      payment_type: 'contribution',
      payment_source: 'kcb_buni',
      provider_transaction_id: providerTransactionId,
      payer_phone: notification.payerPhone,
      action_by: actorId,
      request_id: requestId,
      receipt_number: receiptNumber,
    };

    transaction.create(commandRef, { type: 'reconcileKcbPayment', actorId, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    transaction.create(db().doc(`members/${memberId}/payments/${paymentId}`), payment);
    transaction.update(contributionRef, {
      payments: admin.firestore.FieldValue.arrayUnion(payment),
      balance: result.remainingBalance,
      paid: result.remainingBalance === 0 ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.PARTIAL,
    });
    transaction.update(memberRef, {
      balance: admin.firestore.FieldValue.increment(Number(notification.amount)),
      contributionBalance: admin.firestore.FieldValue.increment(result.contributionAmount),
    });
    transaction.set(db().doc(`monthly_stats/${contributionId}`), {
      contribution: admin.firestore.FieldValue.increment(result.contributionAmount), month: contributionId,
    }, { merge: true });
    transaction.update(notificationRef, {
      status: 'reconciled', memberId, contributionId, paymentId, receiptNumber,
      reconciledAt: admin.firestore.FieldValue.serverTimestamp(), reconciledBy: actorId,
    });
    transaction.create(db().doc(`audit_events/${requestId}`), {
      requestId, actorId, action: 'kcb_payment.reconciled', memberId, targetId: paymentId,
      changes: { providerTransactionId, amount: notification.amount, contributionId, receiptNumber },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.create(db().doc(`notification_events/payment-reconciled-${paymentId}`), {
      type: 'payment.reconciled', memberId, paymentId, receiptNumber,
      amount: notification.amount, source: 'kcb_buni', createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { requestId, paymentId, receiptNumber, duplicate: false };
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
    const notificationRef = db().doc(`kcb_payment_notifications/${providerTransactionId}`);
    const [command, notification] = await Promise.all([transaction.get(commandRef), transaction.get(notificationRef)]);
    if (command.exists) return { requestId, duplicate: true };
    if (!notification.exists) throw new HttpsError('not-found', 'KCB payment notification not found.');
    if (notification.data()?.status !== 'unresolved') {
      throw new HttpsError('failed-precondition', 'Only unresolved notifications can be rejected.');
    }
    transaction.create(commandRef, {
      type: 'rejectKcbPayment', actorId, createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.update(notificationRef, {
      status: 'rejected', rejectionReason: reason, rejectedBy: actorId,
      rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.create(db().doc(`audit_events/${requestId}`), {
      requestId, actorId, action: 'kcb_payment.rejected', memberId: '', targetId: providerTransactionId,
      changes: { reason }, createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { requestId, duplicate: false };
  });
});

const bearerToken = async () => {
  const authorization = Buffer.from(`${consumerKey.value()}:${consumerSecret.value()}`).toString('base64');
  const response = await fetch(tokenUrl.value(), { method: 'POST', headers: { Authorization: `Basic ${authorization}` } });
  if (!response.ok) {
    throw new Error(`KCB token request failed with status ${response.status}.`);
  }
  const body = await response.json() as { access_token?: unknown };
  if (typeof body.access_token !== 'string' || !body.access_token) throw new Error('KCB token response did not include an access token.');
  return body.access_token;
};

export const requestKcbStkPush = onCall({ secrets: [consumerKey, consumerSecret] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in is required.');
  }
  const data = request.data as Data;
  const requestId = requiredString(data, 'requestId');
  const memberId = requiredString(data, 'memberId');
  const contributionId = requiredString(data, 'contributionId');
  if (request.auth.uid !== memberId && request.auth.token.role !== 'administrator') {
    throw new HttpsError('permission-denied', 'You cannot request payment for this member.');
  }
  const amount = Number(data.amount);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new HttpsError('invalid-argument', 'amount must be a positive whole number.');
  }
  const callbackUrl = stkCallbackUrl.value();
  if (!callbackUrl.startsWith('https://')) {
    throw new HttpsError('failed-precondition', 'KCB_STK_CALLBACK_URL must be a public HTTPS URL.');
  }
  const requestRef = db().doc(`kcb_stk_requests/${requestId}`);
  const existing = await requestRef.get();
  if (existing.exists) return { requestId, ...existing.data(), duplicate: true };

  const [member, contribution] = await Promise.all([
    db().doc(`members/${memberId}`).get(), db().doc(`members/${memberId}/contributions/${contributionId}`).get(),
  ]);
  if (!member.exists || !contribution.exists) {
    throw new HttpsError('not-found', 'Member or contribution not found.');
  }
  if (amount > Number(contribution.data()?.balance ?? 0)) {
    throw new HttpsError('invalid-argument', 'amount exceeds the contribution balance.');
  }
  let phone: string;
  try {
    phone = normalizeKenyanPhone(requiredString(member.data() as Data, 'phonenumber'));
  } catch {
    throw new HttpsError('failed-precondition', 'Member must have a valid Kenyan phone number.');
  }
  const invoiceNumber = `TMB${randomUUID().replace(/-/g, '').slice(0, 9)}`.toUpperCase();
  const messageId = randomUUID().replace(/-/g, '').slice(0, 32);

  await requestRef.create({
    requestId, memberId, contributionId, amount, phone, invoiceNumber, messageId, status: 'initiating',
    requestedBy: request.auth.uid, createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  try {
    const token = await bearerToken();
    const response = await fetch(stkUrl.value(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        routeCode: routeCode.value(), operation: 'STKPush', messageId,
      },
      body: JSON.stringify({
        phoneNumber: phone.slice(1), amount: String(amount), invoiceNumber, sharedShortCode: true,
        orgShortCode: orgShortCode.value(), orgPassKey: '', callbackUrl, transactionDescription: 'TMBWA payment',
      }),
    });
    const body = await response.json() as {
      header?: { statusCode?: unknown; statusDescription?: unknown };
      response?: Record<string, unknown>;
    };
    const accepted = response.ok && String(body.header?.statusCode) === '0' && Number(body.response?.ResponseCode) === 0;
    const merchantRequestId = typeof body.response?.MerchantRequestID === 'string' ? body.response.MerchantRequestID : null;
    const checkoutRequestId = typeof body.response?.CheckoutRequestID === 'string' ? body.response.CheckoutRequestID : null;
    await requestRef.update({
      status: accepted ? 'pending' : 'rejected', merchantRequestId, checkoutRequestId,
      responseCode: body.response?.ResponseCode ?? null,
      responseDescription: body.response?.ResponseDescription ?? body.header?.statusDescription ?? null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (!accepted || !checkoutRequestId) {
      throw new HttpsError('failed-precondition', 'KCB did not accept the STK request.');
    }
    return { requestId, status: 'pending', merchantRequestId, checkoutRequestId, duplicate: false };
  } catch (error) {
    await requestRef.update({
      status: 'failed',
      failureCategory: error instanceof HttpsError ? 'provider_rejected' : 'provider_unavailable',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (error instanceof HttpsError) throw error;
    logger.error('KCB STK request failed.', { requestId, reason: (error as Error).message });
    throw new HttpsError('unavailable', 'KCB payment request is temporarily unavailable.');
  }
});

export const kcbStkCallback = onRequest(async (request, response) => {
  if (request.method !== 'POST') {
    response.status(405).send('Method not allowed.'); return;
  }
  try {
    const callback = parseStkCallback(request.body);
    const matches = await db().collection('kcb_stk_requests')
      .where('checkoutRequestId', '==', callback.checkoutRequestId).limit(1).get();
    if (matches.empty) {
      logger.warn('Unmatched KCB STK callback.');
      response.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
      return;
    }
    const requestRef = matches.docs[0].ref;
    await db().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(requestRef);
      const pending = snapshot.data()!;
      if (pending.callbackReceivedAt) return;
      if (callback.merchantRequestId !== pending.merchantRequestId) throw new Error('STK callback correlation mismatch.');
      if (callback.resultCode !== 0) {
        let status = 'failed';
        if (callback.resultCode === 1032) status = 'cancelled';
        if (callback.resultCode === 1037) status = 'timed_out';
        transaction.update(requestRef, {
          status,
          resultCode: callback.resultCode, resultDescription: callback.resultDescription,
          callbackReceivedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return;
      }
      if (callback.amount !== Number(pending.amount) ||
          callback.payerPhone !== pending.phone || !callback.receiptNumber) {
        throw new Error('STK callback payment details do not match the pending request.');
      }
      const notificationRef = db().doc(`kcb_payment_notifications/${callback.receiptNumber}`);
      const existingNotification = await transaction.get(notificationRef);
      if (!existingNotification.exists) {
        transaction.create(notificationRef, {
          providerTransactionId: callback.receiptNumber, messageId: callback.checkoutRequestId,
          channelCode: 'stk', billReference: pending.invoiceNumber, payerPhone: callback.payerPhone,
          payerName: '', amount: callback.amount, currency: expectedCurrency.value(),
          transactionDate: callback.transactionDate, transactionType: 'MPESA_STK', status: 'unresolved',
          suggestedMemberId: pending.memberId, matchReason: 'authenticated_stk_request', provider: 'kcb_buni', source: 'stk_callback',
          stkRequestId: snapshot.id, receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      transaction.update(requestRef, {
        status: 'succeeded_pending_reconciliation', providerTransactionId: callback.receiptNumber,
        resultCode: callback.resultCode, resultDescription: callback.resultDescription,
        callbackReceivedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    response.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    logger.warn('Rejected invalid KCB STK callback.', { reason: (error as Error).message });
    response.status(400).json({ ResultCode: 1, ResultDesc: 'Invalid callback' });
  }
});
