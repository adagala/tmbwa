import { generateKeyPairSync, createSign } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  acknowledgement, billReferenceMatchesSharedReference,
  canAutomaticallyAllocateStkPayment,
  isActiveStkRequestStatus, isLockedStkReconciliation,
  isManuallyResolvableStkUnknownOutcome,
  isRecoverableStkLeaseStatus,
  isSameStkRequestPayload, isStkInitiationLeaseExpired,
  isSuccessfulStkDuplicateStatus,
  KcbNotificationValidationError,
  lockedStkAllocationAmount, normalizeKenyanPhone,
  ownsExpectedStkTransition, parseKcbTransactionDate, parseStkCallback,
  parseTillNotification, permitsUnsignedSandboxNotification,
  secureTokenMatches, stkFailureStatus, stkPaymentMatchesPendingRequest,
  terminalNotificationMatchesStkRequest,
  unmatchedStkCallbackMatchesRequest,
  verifyKcbSignature,
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

  it('accepts direct and server-generated STK bill references only', () => {
    expect(billReferenceMatchesSharedReference('7969138', '7969138')).toBe(true);
    expect(billReferenceMatchesSharedReference(
      '7969138#TMB123456789', '7969138',
    )).toBe(true);
    expect(billReferenceMatchesSharedReference('79691380', '7969138')).toBe(false);
    expect(billReferenceMatchesSharedReference(
      'OTHER#TMB123456789', '7969138',
    )).toBe(false);
    expect(billReferenceMatchesSharedReference('anything', '')).toBe(false);
  });

  it('identifies validation errors that are acknowledged but handled internally', () => {
    const error = new KcbNotificationValidationError(
      'Unexpected bill reference.',
    );
    expect(error).toBeInstanceOf(KcbNotificationValidationError);
    expect(error.message).toBe('Unexpected bill reference.');
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

  it('treats repeated STK request IDs as idempotent only for identical payloads', () => {
    expect(isSameStkRequestPayload(
      { memberId: 'member-1', contributionId: '2026-08-01', amount: 500 },
      { memberId: 'member-1', contributionId: '2026-08-01', amount: 500 },
    )).toBe(true);
    expect(isSameStkRequestPayload(
      { memberId: 'member-1', contributionId: '2026-08-01', amount: 500 },
      { memberId: 'member-1', contributionId: '2026-08-01', amount: 400 },
    )).toBe(false);
  });

  it('maps callback failure codes to explicit STK statuses', () => {
    expect(stkFailureStatus(1032)).toBe('cancelled');
    expect(stkFailureStatus(1037)).toBe('timed_out');
    expect(stkFailureStatus(1)).toBe('failed');
  });

  it('requires exact callback payment details before accepting pending STK success', () => {
    expect(stkPaymentMatchesPendingRequest({
      callbackAmount: 500,
      pendingAmount: 500,
      callbackPhone: '+254711000000',
      pendingPhone: '+254711000000',
      receiptNumber: 'RCP123',
    })).toBe(true);
    expect(stkPaymentMatchesPendingRequest({
      callbackAmount: 499,
      pendingAmount: 500,
      callbackPhone: '+254711000000',
      pendingPhone: '+254711000000',
      receiptNumber: 'RCP123',
    })).toBe(false);
    expect(stkPaymentMatchesPendingRequest({
      callbackAmount: 500,
      pendingAmount: 500,
      callbackPhone: '+254711111111',
      pendingPhone: '+254711000000',
      receiptNumber: 'RCP123',
    })).toBe(false);
    expect(stkPaymentMatchesPendingRequest({
      callbackAmount: 500,
      pendingAmount: 500,
      callbackPhone: '+254711000000',
      pendingPhone: '+254711000000',
      receiptNumber: '',
    })).toBe(false);
  });

  it('automatically allocates only exact full-balance STK payments with an owned active lock', () => {
    const eligiblePayment = {
      callbackAmount: 500,
      requestedAmount: 500,
      outstandingAmount: 500,
      requestId: 'stk-request-1',
      lockRequestId: 'stk-request-1',
      lockStatus: 'pending',
      notificationConflict: false,
    };
    expect(canAutomaticallyAllocateStkPayment(eligiblePayment)).toBe(true);
    expect(canAutomaticallyAllocateStkPayment({
      ...eligiblePayment, outstandingAmount: 1_000,
    })).toBe(false);
    expect(canAutomaticallyAllocateStkPayment({
      ...eligiblePayment, outstandingAmount: 250,
    })).toBe(false);
    expect(canAutomaticallyAllocateStkPayment({
      ...eligiblePayment, lockRequestId: 'another-request',
    })).toBe(false);
    expect(canAutomaticallyAllocateStkPayment({
      ...eligiblePayment, lockStatus: 'reconciled',
    })).toBe(false);
    expect(canAutomaticallyAllocateStkPayment({
      ...eligiblePayment, notificationConflict: true,
    })).toBe(false);
  });

  it('keeps a correlated early callback eligible unless its receipt conflicts', () => {
    const correlatedEarlyCallback = {
      callbackAmount: 500,
      requestedAmount: 500,
      outstandingAmount: 500,
      requestId: 'stk-request-1',
      lockRequestId: 'stk-request-1',
      lockStatus: 'dispatching',
      notificationConflict: false,
    };
    expect(
      canAutomaticallyAllocateStkPayment(correlatedEarlyCallback),
    ).toBe(true);
    expect(canAutomaticallyAllocateStkPayment({
      ...correlatedEarlyCallback,
      notificationConflict: true,
    })).toBe(false);
  });

  it('identifies STK-origin contribution locks for reconciliation guards', () => {
    expect(isLockedStkReconciliation({
      source: 'stk_callback',
    })).toBe(true);
    expect(isLockedStkReconciliation({
      source: 'till_notification',
    })).toBe(false);
    expect(isLockedStkReconciliation({
      source: 'stk_callback',
    })).toBe(true);
  });

  it('blocks concurrent STK requests until the active request is terminal', () => {
    expect(isActiveStkRequestStatus('initiating')).toBe(true);
    expect(isActiveStkRequestStatus('dispatching')).toBe(true);
    expect(isActiveStkRequestStatus('outcome_unknown')).toBe(true);
    expect(isActiveStkRequestStatus('pending')).toBe(true);
    expect(isActiveStkRequestStatus('succeeded_pending_reconciliation')).toBe(true);
    expect(isActiveStkRequestStatus('failed')).toBe(false);
    expect(isActiveStkRequestStatus('rejected')).toBe(false);
    expect(isActiveStkRequestStatus('cancelled')).toBe(false);
    expect(isActiveStkRequestStatus('timed_out')).toBe(false);
    expect(isActiveStkRequestStatus('reconciled')).toBe(false);
  });

  it('reports only accepted STK duplicates as successful', () => {
    expect(isSuccessfulStkDuplicateStatus('pending')).toBe(true);
    expect(isSuccessfulStkDuplicateStatus('succeeded_pending_reconciliation')).toBe(true);
    expect(isSuccessfulStkDuplicateStatus('initiating')).toBe(false);
    expect(isSuccessfulStkDuplicateStatus('failed')).toBe(false);
    expect(isSuccessfulStkDuplicateStatus('rejected')).toBe(false);
    expect(isSuccessfulStkDuplicateStatus('cancelled')).toBe(false);
    expect(isSuccessfulStkDuplicateStatus('timed_out')).toBe(false);
  });

  it('recovers initiating requests only after their lease expires', () => {
    expect(isRecoverableStkLeaseStatus('initiating')).toBe(true);
    expect(isRecoverableStkLeaseStatus('outcome_unknown')).toBe(false);
    expect(isRecoverableStkLeaseStatus('pending')).toBe(false);
    expect(isStkInitiationLeaseExpired(1_000, 1_000)).toBe(true);
    expect(isStkInitiationLeaseExpired(1_001, 1_000)).toBe(false);
    expect(isStkInitiationLeaseExpired(undefined, 1_000)).toBe(false);
  });

  it('allows manual failure resolution only for ambiguous provider dispatches', () => {
    expect(isManuallyResolvableStkUnknownOutcome({
      status: 'dispatching', failureCategory: undefined, resultCode: undefined,
    })).toBe(true);
    expect(isManuallyResolvableStkUnknownOutcome({
      status: 'outcome_unknown', failureCategory: 'provider_outcome_unknown',
      resultCode: undefined,
    })).toBe(true);
    expect(isManuallyResolvableStkUnknownOutcome({
      status: 'outcome_unknown',
      failureCategory: 'provider_response_missing_correlation_ids',
      resultCode: undefined,
    })).toBe(true);
    expect(isManuallyResolvableStkUnknownOutcome({
      status: 'outcome_unknown', failureCategory: undefined, resultCode: 0,
    })).toBe(false);
    expect(isManuallyResolvableStkUnknownOutcome({
      status: 'outcome_unknown', failureCategory: undefined, resultCode: 1032,
    })).toBe(false);
  });

  it('releases terminal receipt locks only for matching STK linkage', () => {
    const request = {
      requestId: 'stk-1', memberId: 'member-1',
      contributionId: '2026-08-01', amount: 500,
    };
    expect(terminalNotificationMatchesStkRequest({
      ...request, notificationStatus: 'reconciled',
      notificationMemberId: 'member-1', notificationStkRequestId: undefined,
      allocations: [{ contributionId: '2026-08-01', amount: 500 }],
    })).toBe(true);
    expect(terminalNotificationMatchesStkRequest({
      ...request, notificationStatus: 'reconciled',
      notificationMemberId: 'member-2', notificationStkRequestId: undefined,
      allocations: [{ contributionId: 'different', amount: 500 }],
    })).toBe(false);
    expect(terminalNotificationMatchesStkRequest({
      ...request, notificationStatus: 'rejected',
      notificationMemberId: undefined, notificationStkRequestId: 'stk-1',
      allocations: [],
    })).toBe(true);
  });

  it('applies STK state transitions only while request and lock still match', () => {
    expect(ownsExpectedStkTransition({
      requestStatus: 'dispatching', expectedStatus: 'dispatching',
      requestId: 'stk-1', lockRequestId: 'stk-1', lockStatus: 'dispatching',
    })).toBe(true);
    expect(ownsExpectedStkTransition({
      requestStatus: 'failed', expectedStatus: 'dispatching',
      requestId: 'stk-1', lockRequestId: 'stk-1', lockStatus: 'failed',
    })).toBe(false);
  });

  it('allocates STK overpayments to the contribution and reserves the excess', () => {
    expect(lockedStkAllocationAmount(600, 500, 500)).toBe(500);
    expect(lockedStkAllocationAmount(400, 500, 500)).toBe(400);
    expect(lockedStkAllocationAmount(600, 500, 450)).toBe(450);
    expect(() => lockedStkAllocationAmount(0, 500, 500)).toThrow();
  });

  it('correlates quarantined callbacks only to the exact provider request', () => {
    const request = {
      requestMerchantRequestId: 'merchant-1', requestAmount: 500,
      requestPhone: '+254711000000',
    };
    expect(unmatchedStkCallbackMatchesRequest({
      ...request, callbackMerchantRequestId: 'merchant-1',
      callbackAmount: 500, callbackPhone: '+254711000000',
    })).toBe(true);
    expect(unmatchedStkCallbackMatchesRequest({
      ...request, callbackMerchantRequestId: 'merchant-2',
      callbackAmount: 500, callbackPhone: '+254711000000',
    })).toBe(false);
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
