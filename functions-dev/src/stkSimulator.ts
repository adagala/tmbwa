import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { nairobiCompactTimestamp } from './devSimulator';

// Pure helpers for the development-only KCB STK simulator. The mock API stands
// in for KCB's token and STK endpoints, and a simulated phone action posts the
// STK result to the real deployed kcbStkCallback.

export const STK_PROMPT_OUTCOMES = ['approve', 'cancel', 'timeout'] as const;
export type StkPromptOutcome = (typeof STK_PROMPT_OUTCOMES)[number];

export const isStkPromptOutcome = (value: unknown): value is StkPromptOutcome =>
  typeof value === 'string' && (STK_PROMPT_OUTCOMES as readonly string[]).includes(value);

export type MockStkPushRequest = {
  phoneNumber: string;
  amount: number;
  invoiceNumber: string;
  callbackUrl: string;
};

export type SimulatedStkPrompt = {
  merchantRequestId: string;
  checkoutRequestId: string;
  phoneNumber: string;
  amount: number;
};

const secureEquals = (provided: string, expected: string) => {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
};

const object = (value: unknown, field: string) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
};

export const mockTokenResponse = (accessToken = `dev-${randomBytes(24).toString('hex')}`) => ({
  access_token: accessToken,
  scope: 'am_application_scope default',
  token_type: 'Bearer',
  expires_in: 3600,
});

// Validates the body requestKcbStkPush sends to KCB_STK_URL.
export const parseMockStkPushRequest = (payload: unknown): MockStkPushRequest => {
  const body = object(payload, 'body');
  const phoneNumber = String(body.phoneNumber ?? '');
  if (!/^254[17]\d{8}$/.test(phoneNumber)) {
    throw new Error('phoneNumber must be a Kenyan mobile number in 2547XXXXXXXX form.');
  }
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount < 1) {
    throw new Error('amount must be a positive whole number.');
  }
  const invoiceNumber = typeof body.invoiceNumber === 'string' ? body.invoiceNumber.trim() : '';
  if (!invoiceNumber || invoiceNumber.length > 100) {
    throw new Error('invoiceNumber is required.');
  }
  if (typeof body.callbackUrl !== 'string' || !body.callbackUrl) {
    throw new Error('callbackUrl is required.');
  }
  return { phoneNumber, amount, invoiceNumber, callbackUrl: body.callbackUrl };
};

// Only a caller holding the STK callback token (requestKcbStkPush) may create
// prompts, and only for the configured callback.
export const stkPushCallbackIsTrusted = (args: {
  requestedCallbackUrl: string;
  configuredCallbackUrl: string;
  callbackToken: string;
}) => {
  if (!args.callbackToken) return false;
  let requested: URL;
  let configured: URL;
  try {
    requested = new URL(args.requestedCallbackUrl);
    configured = new URL(args.configuredCallbackUrl);
  } catch {
    return false;
  }
  return (
    requested.origin === configured.origin &&
    requested.pathname === configured.pathname &&
    secureEquals(requested.searchParams.get('token') ?? '', args.callbackToken)
  );
};

export const newSimulatedStkPrompt = (
  request: MockStkPushRequest,
  random = () => randomBytes(10).toString('hex').toUpperCase(),
): SimulatedStkPrompt => ({
  merchantRequestId: `DEV-${random()}`,
  checkoutRequestId: `ws_CO_DEV${random()}`,
  phoneNumber: request.phoneNumber,
  amount: request.amount,
});

// Mirrors KCB's accepted STK response, which requestKcbStkPush checks for.
export const mockStkPushResponse = (prompt: SimulatedStkPrompt, messageId: string) => ({
  header: {
    messageId,
    statusCode: '0',
    statusDescription: 'Successfully Accepted Request',
  },
  response: {
    MerchantRequestID: prompt.merchantRequestId,
    CheckoutRequestID: prompt.checkoutRequestId,
    ResponseCode: 0,
    ResponseDescription: 'Success. Request accepted for processing',
    CustomerMessage: 'Success. Request accepted for processing',
  },
});

// Deterministic per prompt, so a repeated approval carries the same receipt and
// the production callback's receipt idempotency applies.
export const devStkReceiptNumber = (checkoutRequestId: string) =>
  `DEV${createHash('sha256').update(`stk:${checkoutRequestId}`).digest('hex').slice(0, 12).toUpperCase()}`;

const failureResults: Record<Exclude<StkPromptOutcome, 'approve'>, { code: number; description: string }> = {
  cancel: { code: 1032, description: 'Request cancelled by user' },
  timeout: { code: 1037, description: 'DS timeout user cannot be reached' },
};

export const buildStkCallbackPayload = (
  prompt: SimulatedStkPrompt,
  outcome: StkPromptOutcome,
  now = new Date(),
) => {
  const base = {
    MerchantRequestID: prompt.merchantRequestId,
    CheckoutRequestID: prompt.checkoutRequestId,
  };
  if (outcome !== 'approve') {
    const failure = failureResults[outcome];
    return { Body: { stkCallback: { ...base, ResultCode: failure.code, ResultDesc: failure.description } } };
  }
  return {
    Body: {
      stkCallback: {
        ...base,
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: prompt.amount },
            { Name: 'MpesaReceiptNumber', Value: devStkReceiptNumber(prompt.checkoutRequestId) },
            { Name: 'Balance' },
            { Name: 'TransactionDate', Value: Number(nairobiCompactTimestamp(now)) },
            { Name: 'PhoneNumber', Value: Number(prompt.phoneNumber) },
          ],
        },
      },
    },
  };
};

// A claim older than this is treated as abandoned and may be retried with the
// same outcome; the callback is idempotent for that outcome.
export const STK_PROMPT_CLAIM_MS = 30 * 1000;

export type StkPromptResolutionDecision =
  | { action: 'claim' }
  | { action: 'already_resolved' }
  | { action: 'in_progress' }
  | { action: 'conflict' };

export const stkPromptResolutionDecision = (args: {
  status: unknown;
  storedOutcome: unknown;
  requestedOutcome: StkPromptOutcome;
  claimedAtMs: number | undefined;
  nowMs: number;
}): StkPromptResolutionDecision => {
  if (args.status === 'pending') return { action: 'claim' };
  if (args.storedOutcome !== args.requestedOutcome) return { action: 'conflict' };
  if (args.status === 'resolved') return { action: 'already_resolved' };
  if (args.claimedAtMs !== undefined && args.nowMs - args.claimedAtMs < STK_PROMPT_CLAIM_MS) {
    return { action: 'in_progress' };
  }
  return { action: 'claim' };
};
