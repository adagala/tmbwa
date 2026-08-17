import { generateKeyPairSync, createSign } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  acknowledgement, normalizeKenyanPhone, parseKcbTransactionDate, parseStkCallback,
  parseTillNotification, permitsUnsignedSandboxNotification,
  secureTokenMatches, verifyKcbSignature,
} from '../functions/src/kcb/domain';
import {
  buildSyntheticTillPayload,
  devProviderTransactionId,
  validateDevSimulatorConfig,
} from '../functions-dev/src/devSimulator';

const payload = {
  header: { messageID: 'message-1', originatorConversationID: 'conversation-1', channelCode: '202' },
  requestPayload: { additionalData: { notificationData: {
    businessKey: '7969138', businessKeyType: 'BillReferenceNumber', debitMSISDN: '0711000000',
    transactionAmt: '1000', transactionDate: 'Mon May 19 13:30:54 EAT 2025', transactionID: 'FT25139M3RM6',
    firstName: 'PETER', middleName: 'BOR', lastName: '', currency: 'kes', transactionType: 'MPESA',
  } } },
};

describe('KCB Till notification contract', () => {
  it('normalizes supported Kenyan phone formats', () => {
    expect(normalizeKenyanPhone('0711 000 000')).toBe('+254711000000');
    expect(normalizeKenyanPhone('254711000000')).toBe('+254711000000');
    expect(() => normalizeKenyanPhone('123')).toThrow();
  });

  it('extracts safe reconciliation fields', () => {
    expect(parseTillNotification(payload)).toMatchObject({
      messageId: 'message-1', providerTransactionId: 'FT25139M3RM6', billReference: '7969138',
      payerPhone: '+254711000000', payerName: 'PETER BOR', amount: 1000, currency: 'KES',
    });
  });

  it('rejects malformed and non-positive payments', () => {
    expect(() => parseTillNotification({})).toThrow();
    expect(() => parseTillNotification({ ...payload, requestPayload: { additionalData: { notificationData: {
      ...payload.requestPayload.additionalData.notificationData, transactionAmt: '0',
    } } } })).toThrow();
  });

  it('verifies SHA256withRSA over the unmodified bytes', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const raw = Buffer.from(JSON.stringify(payload));
    const signer = createSign('RSA-SHA256');
    signer.update(raw); signer.end();
    const signature = signer.sign(privateKey, 'base64');
    expect(verifyKcbSignature(raw, signature, publicKey.export({ type: 'spki', format: 'pem' }).toString())).toBe(true);
    expect(verifyKcbSignature(Buffer.from(`${raw.toString()} `), signature, publicKey.export({ type: 'spki', format: 'pem' }).toString())).toBe(false);
  });

  it('permits unsigned notifications only in explicitly enabled development', () => {
    expect(permitsUnsignedSandboxNotification('development', 'true')).toBe(true);
    expect(permitsUnsignedSandboxNotification('development', 'false')).toBe(false);
    expect(permitsUnsignedSandboxNotification('production', 'true')).toBe(false);
    expect(permitsUnsignedSandboxNotification('uat', 'true')).toBe(false);
  });

  it('returns the documented acknowledgement shape', () => {
    expect(acknowledgement('m1', 'c1', 'ours-1', true, 'received')).toEqual({
      header: { messageID: 'm1', originatorConversationID: 'c1', statusCode: '0', statusMessage: 'received' },
      responsePayload: { transactionInfo: { transactionId: 'ours-1' } },
    });
  });

  it('parses successful and cancelled STK callbacks without treating acceptance as payment', () => {
    expect(parseStkCallback({ Body: { stkCallback: {
      MerchantRequestID: 'merchant-1', CheckoutRequestID: 'checkout-1', ResultCode: 0, ResultDesc: 'Success',
      CallbackMetadata: { Item: [
        { Name: 'Amount', Value: 1000 }, { Name: 'MpesaReceiptNumber', Value: 'RCP123' },
        { Name: 'TransactionDate', Value: 20260813121212 }, { Name: 'PhoneNumber', Value: 254711000000 },
      ] },
    } } })).toMatchObject({ resultCode: 0, receiptNumber: 'RCP123', amount: 1000, payerPhone: '+254711000000' });
    expect(parseStkCallback({ Body: { stkCallback: {
      MerchantRequestID: 'merchant-1', CheckoutRequestID: 'checkout-1', ResultCode: 1032, ResultDesc: 'Cancelled',
    } } })).toEqual({
      merchantRequestId: 'merchant-1', checkoutRequestId: 'checkout-1', resultCode: 1032, resultDescription: 'Cancelled',
    });
  });

  it('authenticates callback tokens without accepting partial matches', () => {
    expect(secureTokenMatches('secret-token', 'secret-token')).toBe(true);
    expect(secureTokenMatches('secret', 'secret-token')).toBe(false);
  });

  it('parses Till and STK timestamps in East Africa Time', () => {
    expect(parseKcbTransactionDate('Mon May 19 13:30:54 EAT 2025').toISOString()).toBe('2025-05-19T10:30:54.000Z');
    expect(parseKcbTransactionDate('20260813121212').toISOString()).toBe('2026-08-13T09:12:12.000Z');
    expect(() => parseKcbTransactionDate('not-a-date')).toThrow();
  });
});

describe('deployed development KCB simulator', () => {
  it('fails closed unless development is explicitly enabled', () => {
    const valid = {
      appEnvironment: 'development',
      enabled: 'true',
      callbackUrl: 'https://dev.example.test/kcbTillNotification',
      allowedOrigin: 'https://dev.example.test',
    };
    expect(validateDevSimulatorConfig(valid)).toBe(valid.callbackUrl);
    expect(() => validateDevSimulatorConfig({
      ...valid,
      appEnvironment: 'production',
    })).toThrow();
    expect(() => validateDevSimulatorConfig({
      ...valid,
      enabled: 'false',
    })).toThrow();
    expect(() => validateDevSimulatorConfig({
      ...valid,
      callbackUrl: 'https://evil.example/kcbTillNotification',
    })).toThrow();
    expect(() => validateDevSimulatorConfig({
      ...valid,
      callbackUrl: 'http://dev.example.test/kcbTillNotification',
    })).toThrow();
  });

  it('creates deterministic, synthetic-only Till payloads', () => {
    const now = new Date('2026-08-17T12:00:00Z');
    const first = buildSyntheticTillPayload(
      'request_12345678', 250, '7969138', now,
    );
    const second = buildSyntheticTillPayload(
      'request_12345678', 250, '7969138', now,
    );
    expect(first.providerTransactionId).toBe(
      devProviderTransactionId('request_12345678'),
    );
    expect(second.providerTransactionId).toBe(first.providerTransactionId);
    expect(
      first.payload.requestPayload.additionalData.notificationData,
    ).toMatchObject({
      debitMSISDN: '254700000001',
      firstName: 'TMBWA',
      lastName: 'TEST',
      transactionAmt: '250',
      businessKey: '7969138',
    });
    expect(parseTillNotification(first.payload)).toMatchObject({
      providerTransactionId: first.providerTransactionId,
      billReference: '7969138',
      payerPhone: '+254700000001',
      payerName: 'TMBWA DEV TEST',
      amount: 250,
      currency: 'KES',
    });
    expect(() => buildSyntheticTillPayload(
      'request_12345678', 0, '7969138',
    )).toThrow();
  });

});
