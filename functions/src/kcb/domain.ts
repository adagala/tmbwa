import { createVerify, timingSafeEqual } from 'crypto';

export type KcbTillNotification = {
  messageId: string;
  conversationId?: string;
  channelCode: string;
  providerTransactionId: string;
  billReference: string;
  payerPhone: string;
  payerName: string;
  amount: number;
  currency: string;
  transactionDate: string;
  transactionType?: string;
  narration?: string;
};

export type StkCallback = {
  merchantRequestId: string;
  checkoutRequestId: string;
  resultCode: number;
  resultDescription: string;
  receiptNumber?: string;
  amount?: number;
  payerPhone?: string;
  transactionDate?: string;
};

export type StoredStkRequest = {
  memberId: string;
  contributionId: string;
  amount: number;
};

export type IncomingStkRequest = {
  memberId: string;
  contributionId: string;
  amount: number;
};

type JsonObject = Record<string, unknown>;

const object = (value: unknown, field: string): JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as JsonObject;
};

const text = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
};

const optionalText = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;

export const normalizeKenyanPhone = (value: string) => {
  const digits = value.replace(/\D/g, '');
  if (/^254[17]\d{8}$/.test(digits)) return `+${digits}`;
  if (/^0[17]\d{8}$/.test(digits)) return `+254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `+254${digits}`;
  throw new Error('debitMSISDN must be a valid Kenyan mobile number.');
};

export const parseTillNotification = (payload: unknown): KcbTillNotification => {
  const root = object(payload, 'body');
  const header = object(root.header, 'header');
  const requestPayload = object(root.requestPayload, 'requestPayload');
  const additionalData = object(requestPayload.additionalData, 'requestPayload.additionalData');
  const notification = object(additionalData.notificationData, 'notificationData');
  const amount = Number(notification.transactionAmt);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('transactionAmt must be greater than zero.');

  const firstName = text(notification.firstName, 'firstName');
  const payerName = [firstName, optionalText(notification.middleName), optionalText(notification.lastName)]
    .filter(Boolean).join(' ');

  return {
    messageId: text(header.messageID, 'header.messageID'),
    conversationId: optionalText(header.originatorConversationID),
    channelCode: text(header.channelCode, 'header.channelCode'),
    providerTransactionId: text(notification.transactionID, 'transactionID'),
    billReference: text(notification.businessKey, 'businessKey'),
    payerPhone: normalizeKenyanPhone(text(notification.debitMSISDN, 'debitMSISDN')),
    payerName,
    amount,
    currency: text(notification.currency, 'currency').toUpperCase(),
    transactionDate: text(notification.transactionDate, 'transactionDate'),
    transactionType: optionalText(notification.transactionType),
    narration: optionalText(notification.narration),
  };
};

export const verifyKcbSignature = (rawBody: Buffer, signature: string, publicKey: string) => {
  if (!rawBody.length || !signature.trim() || !publicKey.trim()) return false;
  try {
    const verifier = createVerify('RSA-SHA256');
    verifier.update(rawBody);
    verifier.end();
    return verifier.verify(publicKey.replace(/\\n/g, '\n'), signature.trim(), 'base64');
  } catch {
    return false;
  }
};

export const permitsUnsignedSandboxNotification = (
  appEnvironment: string,
  sandboxIpnEnabled: string,
) => appEnvironment === 'development' && sandboxIpnEnabled === 'true';

export const secureTokenMatches = (provided: string, expected: string) => {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
};

export const parseKcbTransactionDate = (value: string) => {
  const stk = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value);
  const till = /^(?:\w{3} )?(\w{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) EAT (\d{4})$/.exec(value);
  let date: Date;
  if (stk) {
    const [, year, month, day, hour, minute, second] = stk;
    date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+03:00`);
  } else if (till) {
    const [, month, day, hour, minute, second, year] = till;
    date = new Date(`${day} ${month} ${year} ${hour}:${minute}:${second} GMT+0300`);
  } else {
    throw new Error('Unsupported KCB transaction date.');
  }
  if (Number.isNaN(date.getTime())) throw new Error('Invalid KCB transaction date.');
  return date;
};

export const acknowledgement = (
  messageId: string,
  conversationId: string | undefined,
  transactionId: string,
  accepted: boolean,
  statusMessage: string,
) => ({
  header: {
    messageID: messageId,
    ...(conversationId ? { originatorConversationID: conversationId } : {}),
    statusCode: accepted ? '0' : '1',
    statusMessage,
  },
  responsePayload: { transactionInfo: { transactionId } },
});

export const parseStkCallback = (payload: unknown): StkCallback => {
  const root = object(payload, 'body');
  const body = object(root.Body, 'Body');
  const callback = object(body.stkCallback, 'Body.stkCallback');
  const resultCode = Number(callback.ResultCode);
  if (!Number.isInteger(resultCode)) throw new Error('ResultCode is required.');
  const result: StkCallback = {
    merchantRequestId: text(callback.MerchantRequestID, 'MerchantRequestID'),
    checkoutRequestId: text(callback.CheckoutRequestID, 'CheckoutRequestID'),
    resultCode,
    resultDescription: text(callback.ResultDesc, 'ResultDesc'),
  };
  if (resultCode !== 0) return result;

  const metadata = object(callback.CallbackMetadata, 'CallbackMetadata');
  if (!Array.isArray(metadata.Item)) throw new Error('CallbackMetadata.Item is required.');
  const values = new Map<string, unknown>();
  metadata.Item.forEach((entry, index) => {
    const item = object(entry, `CallbackMetadata.Item[${index}]`);
    values.set(text(item.Name, `CallbackMetadata.Item[${index}].Name`), item.Value);
  });
  const amount = Number(values.get('Amount'));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Successful callback amount is invalid.');
  result.amount = amount;
  result.receiptNumber = text(values.get('MpesaReceiptNumber'), 'MpesaReceiptNumber');
  result.payerPhone = normalizeKenyanPhone(String(values.get('PhoneNumber') ?? ''));
  result.transactionDate = text(String(values.get('TransactionDate') ?? ''), 'TransactionDate');
  return result;
};

export const isSameStkRequestPayload = (
  existing: StoredStkRequest,
  incoming: IncomingStkRequest,
) =>
  existing.memberId === incoming.memberId &&
  existing.contributionId === incoming.contributionId &&
  Number(existing.amount) === Number(incoming.amount);

export const stkFailureStatus = (resultCode: number) => {
  if (resultCode === 1032) return 'cancelled';
  if (resultCode === 1037) return 'timed_out';
  return 'failed';
};

export const stkPaymentMatchesPendingRequest = (args: {
  callbackAmount: number | undefined;
  pendingAmount: number;
  callbackPhone: string | undefined;
  pendingPhone: string;
  receiptNumber: string | undefined;
}) =>
  Number(args.callbackAmount) === Number(args.pendingAmount) &&
  args.callbackPhone === args.pendingPhone &&
  typeof args.receiptNumber === 'string' &&
  args.receiptNumber.trim().length > 0;

export const isLockedStkReconciliation = (args: {
  source: string | undefined;
}) => args.source === 'stk_callback';

export const isActiveStkRequestStatus = (status: string) =>
  [
    'initiating',
    'dispatching',
    'outcome_unknown',
    'pending',
    'succeeded_pending_reconciliation',
  ].includes(status);

export const isSuccessfulStkDuplicateStatus = (status: string) =>
  ['pending', 'succeeded_pending_reconciliation'].includes(status);

export const isRecoverableStkLeaseStatus = (status: string) =>
  status === 'initiating';

export const isManuallyResolvableStkUnknownOutcome = (args: {
  status: string;
  failureCategory: unknown;
  resultCode: unknown;
}) =>
  args.status === 'dispatching' ||
  (args.status === 'outcome_unknown' &&
    args.resultCode !== 0 &&
    [
      'provider_outcome_unknown',
      'provider_response_missing_correlation_ids',
    ].includes(String(args.failureCategory ?? '')));

export const terminalNotificationMatchesStkRequest = (args: {
  notificationStatus: string;
  notificationMemberId: string | undefined;
  notificationStkRequestId: string | undefined;
  allocations: Array<{ contributionId: string; amount: number }>;
  requestId: string;
  memberId: string;
  contributionId: string;
  amount: number;
}) => {
  if (args.notificationStkRequestId === args.requestId) return true;
  if (args.notificationStatus !== 'reconciled') return false;
  const allocation = args.allocations[0];
  return (
    args.notificationMemberId === args.memberId &&
    args.allocations.length === 1 &&
    allocation?.contributionId === args.contributionId &&
    Number(allocation.amount) === Number(args.amount)
  );
};

export const ownsExpectedStkTransition = (args: {
  requestStatus: string;
  expectedStatus: string;
  requestId: string;
  lockRequestId: unknown;
  lockStatus: unknown;
}) =>
  args.requestStatus === args.expectedStatus &&
  args.lockRequestId === args.requestId &&
  args.lockStatus === args.expectedStatus;

export const lockedStkAllocationAmount = (
  callbackAmount: number,
  requestedAmount: number,
  outstandingAmount: number,
) => {
  if (
    !Number.isFinite(callbackAmount) || callbackAmount <= 0 ||
    !Number.isFinite(requestedAmount) || requestedAmount <= 0 ||
    !Number.isFinite(outstandingAmount) || outstandingAmount <= 0
  ) {
    throw new Error('STK allocation inputs must be positive amounts.');
  }
  return Math.min(callbackAmount, requestedAmount, outstandingAmount);
};

export const unmatchedStkCallbackMatchesRequest = (args: {
  callbackMerchantRequestId: unknown;
  callbackAmount: unknown;
  callbackPhone: unknown;
  requestMerchantRequestId: string | null;
  requestAmount: number;
  requestPhone: string;
}) =>
  args.callbackMerchantRequestId === args.requestMerchantRequestId &&
  Number(args.callbackAmount) === Number(args.requestAmount) &&
  args.callbackPhone === args.requestPhone;

export const isStkInitiationLeaseExpired = (
  leaseExpiresAtMillis: number | undefined,
  nowMillis: number,
) =>
  typeof leaseExpiresAtMillis === 'number' &&
  Number.isFinite(leaseExpiresAtMillis) &&
  leaseExpiresAtMillis <= nowMillis;
