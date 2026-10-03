import { describe, expect, it } from 'vitest';
import {
  isMpesaReceiptNumber,
  parseKcbTransactionDate,
  parseStkCallback,
  stkFailureStatus,
} from '../functions/src/kcb/domain';
import {
  assertDevSimulatorEnabled,
  validateDevSimulatorConfig,
} from '../functions-dev/src/devSimulator';
import {
  buildStkCallbackPayload,
  devStkReceiptNumber,
  isStkPromptOutcome,
  mockStkPushResponse,
  mockTokenResponse,
  newSimulatedStkPrompt,
  parseMockStkPushRequest,
  STK_PROMPT_CLAIM_MS,
  stkPromptResolutionDecision,
  stkPushCallbackIsTrusted,
} from '../functions-dev/src/stkSimulator';

const callbackToken = 'synthetic-callback-token';
const configuredCallbackUrl = 'https://dev.example.test/kcbStkCallback';

// The body requestKcbStkPush sends to KCB_STK_URL.
const stkPushBody = {
  phoneNumber: '254712345678',
  amount: '1500',
  invoiceNumber: '7969138#TMBABC123DEF',
  sharedShortCode: true,
  orgShortCode: '',
  orgPassKey: '',
  callbackUrl: `${configuredCallbackUrl}?token=${callbackToken}`,
  transactionDescription: 'TMBWA payment',
};

const prompt = {
  merchantRequestId: 'DEV-AAAA',
  checkoutRequestId: 'ws_CO_DEVBBBB',
  phoneNumber: '254712345678',
  amount: 1500,
};

describe('development STK simulator gate', () => {
  const valid = {
    appEnvironment: 'development',
    enabled: 'true',
    callbackUrl: configuredCallbackUrl,
    allowedOrigin: 'https://dev.example.test',
    callbackFunction: 'kcbStkCallback' as const,
  };

  it('refuses to run outside an enabled development environment', () => {
    expect(() => assertDevSimulatorEnabled({ appEnvironment: 'development', enabled: 'true' })).not.toThrow();
    for (const config of [
      { appEnvironment: 'production', enabled: 'true' },
      { appEnvironment: 'uat', enabled: 'true' },
      { appEnvironment: 'development', enabled: 'false' },
      { appEnvironment: 'development', enabled: 'TRUE' },
    ]) {
      expect(() => assertDevSimulatorEnabled(config)).toThrow();
      expect(() => validateDevSimulatorConfig({ ...valid, ...config })).toThrow();
    }
  });

  it('only targets the allowed HTTPS kcbStkCallback', () => {
    expect(validateDevSimulatorConfig(valid)).toBe(configuredCallbackUrl);
    for (const callbackUrl of [
      'http://dev.example.test/kcbStkCallback',
      'https://evil.example/kcbStkCallback',
      'https://dev.example.test/kcbTillNotification',
      'https://dev.example.test/kcbStkCallback/extra',
    ]) {
      expect(() => validateDevSimulatorConfig({ ...valid, callbackUrl })).toThrow();
    }
    // The Till simulator keeps its own target.
    expect(() => validateDevSimulatorConfig({ ...valid, callbackFunction: 'kcbTillNotification' })).toThrow();
  });
});

describe('mock KCB API', () => {
  it('returns a synthetic bearer token', () => {
    const body = mockTokenResponse();
    expect(body.access_token).toMatch(/^dev-[0-9a-f]+$/);
    expect(body.token_type).toBe('Bearer');
    expect(mockTokenResponse().access_token).not.toBe(body.access_token);
  });

  it('accepts the STK request body requestKcbStkPush sends', () => {
    expect(parseMockStkPushRequest(stkPushBody)).toEqual({
      phoneNumber: '254712345678',
      amount: 1500,
      invoiceNumber: '7969138#TMBABC123DEF',
      callbackUrl: stkPushBody.callbackUrl,
    });
    for (const invalid of [
      { ...stkPushBody, phoneNumber: '0712345678' },
      { ...stkPushBody, amount: '0' },
      { ...stkPushBody, amount: '10.5' },
      { ...stkPushBody, invoiceNumber: '' },
      { ...stkPushBody, callbackUrl: undefined },
    ]) {
      expect(() => parseMockStkPushRequest(invalid)).toThrow();
    }
    expect(() => parseMockStkPushRequest(null)).toThrow();
  });

  it('only records prompts for the configured callback and its token', () => {
    const trusted = (requestedCallbackUrl: string, token = callbackToken) =>
      stkPushCallbackIsTrusted({ requestedCallbackUrl, configuredCallbackUrl, callbackToken: token });
    expect(trusted(stkPushBody.callbackUrl)).toBe(true);
    expect(trusted(`${configuredCallbackUrl}?token=wrong`)).toBe(false);
    expect(trusted(configuredCallbackUrl)).toBe(false);
    expect(trusted(`https://evil.example/kcbStkCallback?token=${callbackToken}`)).toBe(false);
    expect(trusted(`https://dev.example.test/other?token=${callbackToken}`)).toBe(false);
    expect(trusted('not a url')).toBe(false);
    expect(trusted(configuredCallbackUrl, '')).toBe(false);
  });

  it('returns the accepted response requestKcbStkPush checks for, with new IDs', () => {
    let counter = 0;
    const random = () => `ID${++counter}`;
    const created = newSimulatedStkPrompt(parseMockStkPushRequest(stkPushBody), random);
    expect(created).toEqual({
      merchantRequestId: 'DEV-ID1',
      checkoutRequestId: 'ws_CO_DEVID2',
      phoneNumber: '254712345678',
      amount: 1500,
    });
    const body = mockStkPushResponse(created, 'message-1');
    expect(String(body.header.statusCode)).toBe('0');
    expect(Number(body.response.ResponseCode)).toBe(0);
    expect(body.response.MerchantRequestID).toBe('DEV-ID1');
    expect(body.response.CheckoutRequestID).toBe('ws_CO_DEVID2');
    const other = newSimulatedStkPrompt(parseMockStkPushRequest(stkPushBody));
    expect(other.checkoutRequestId).not.toBe(newSimulatedStkPrompt(parseMockStkPushRequest(stkPushBody)).checkoutRequestId);
  });
});

describe('simulated STK callback payloads', () => {
  it('builds an approval the production callback parser accepts', () => {
    const now = new Date('2026-08-17T12:00:05Z');
    const callback = parseStkCallback(buildStkCallbackPayload(prompt, 'approve', now));
    expect(callback).toEqual({
      merchantRequestId: 'DEV-AAAA',
      checkoutRequestId: 'ws_CO_DEVBBBB',
      resultCode: 0,
      resultDescription: 'The service request is processed successfully.',
      amount: 1500,
      receiptNumber: devStkReceiptNumber('ws_CO_DEVBBBB'),
      payerPhone: '+254712345678',
      transactionDate: '20260817150005',
    });
    expect(isMpesaReceiptNumber(callback.receiptNumber)).toBe(true);
    expect(callback.receiptNumber).toMatch(/^DEV/);
    expect(parseKcbTransactionDate(callback.transactionDate as string).toISOString()).toBe(now.toISOString());
  });

  it('repeats the same receipt for the same prompt', () => {
    const first = parseStkCallback(buildStkCallbackPayload(prompt, 'approve'));
    const second = parseStkCallback(buildStkCallbackPayload(prompt, 'approve'));
    expect(second.receiptNumber).toBe(first.receiptNumber);
    expect(devStkReceiptNumber('ws_CO_DEVCCCC')).not.toBe(first.receiptNumber);
  });

  it('builds cancel and timeout results that map to the STK failure statuses', () => {
    const cancelled = parseStkCallback(buildStkCallbackPayload(prompt, 'cancel'));
    expect(cancelled).toMatchObject({ resultCode: 1032, checkoutRequestId: 'ws_CO_DEVBBBB' });
    expect(cancelled.receiptNumber).toBeUndefined();
    expect(stkFailureStatus(cancelled.resultCode)).toBe('cancelled');
    const timedOut = parseStkCallback(buildStkCallbackPayload(prompt, 'timeout'));
    expect(timedOut.resultCode).toBe(1037);
    expect(stkFailureStatus(timedOut.resultCode)).toBe('timed_out');
  });

  it('accepts only known outcomes', () => {
    expect(['approve', 'cancel', 'timeout'].every(isStkPromptOutcome)).toBe(true);
    expect(isStkPromptOutcome('fail')).toBe(false);
    expect(isStkPromptOutcome(undefined)).toBe(false);
  });
});

describe('simulated STK prompt resolution', () => {
  const nowMs = 1_000_000;
  const decide = (args: Partial<Parameters<typeof stkPromptResolutionDecision>[0]>) =>
    stkPromptResolutionDecision({
      status: 'pending', storedOutcome: undefined, requestedOutcome: 'approve',
      claimedAtMs: undefined, nowMs, ...args,
    }).action;

  it('claims a pending prompt', () => {
    expect(decide({})).toBe('claim');
  });

  it('treats a repeated resolution as a no-op', () => {
    expect(decide({ status: 'resolved', storedOutcome: 'approve' })).toBe('already_resolved');
    expect(decide({ status: 'resolving', storedOutcome: 'approve', claimedAtMs: nowMs - 1000 })).toBe('in_progress');
  });

  it('refuses a different outcome once answered', () => {
    expect(decide({ status: 'resolved', storedOutcome: 'cancel' })).toBe('conflict');
    expect(decide({ status: 'resolving', storedOutcome: 'cancel', claimedAtMs: nowMs })).toBe('conflict');
  });

  it('lets an abandoned claim be retried with the same outcome', () => {
    expect(decide({
      status: 'resolving', storedOutcome: 'approve', claimedAtMs: nowMs - STK_PROMPT_CLAIM_MS,
    })).toBe('claim');
  });
});
