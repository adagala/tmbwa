import { describe, expect, it } from 'vitest';
import {
  contributionOptionsFromDocuments,
  formatEatDate,
  formatEatTime,
  formatReceiptDelay,
  kcbMatchHint,
  kcbMpesaCode,
  kcbReceiptSource,
  kcbTransactionReference,
  KcbReceiptEvidence,
  matchesMemberSearch,
  memberSearchText,
  parseKcbPaymentTime,
} from '../src/lib/kcbReconciliation';
import { parseKcbTransactionDate } from '../functions/src/kcb/domain';

describe('KCB reconciliation contribution options', () => {
  it('includes unpaid and partially paid contributions', () => {
    expect(
      contributionOptionsFromDocuments([
        {
          id: '2026-07-01',
          data: { month: '2026-07-01', balance: 125 },
        },
        {
          id: '2026-08-01',
          data: { month: '2026-08-01', balance: 500 },
        },
      ]),
    ).toEqual({
      options: [
        { id: '2026-08-01', month: '2026-08-01', balance: 500 },
        { id: '2026-07-01', month: '2026-07-01', balance: 125 },
      ],
      invalidDocumentCount: 0,
    });
  });

  it('excludes fully paid contributions', () => {
    expect(
      contributionOptionsFromDocuments([
        {
          id: '2026-08-01',
          data: { month: '2026-08-01', balance: 0 },
        },
      ]).options,
    ).toEqual([]);
  });

  it('ignores unrelated legacy fields and isolates invalid records', () => {
    expect(
      contributionOptionsFromDocuments([
        {
          id: '2026-08-01',
          data: {
            month: '2026-08-01',
            balance: 500,
            membernumber: 'legacy-format',
          },
        },
        { id: 'invalid', data: { month: 'invalid', balance: '500' } },
      ]),
    ).toEqual({
      options: [{ id: '2026-08-01', month: '2026-08-01', balance: 500 }],
      invalidDocumentCount: 1,
    });
  });

  it('uses the document ID when a legacy document has no month field', () => {
    expect(
      contributionOptionsFromDocuments([
        { id: '2026-08-01', data: { balance: 500 } },
      ]).options[0]?.month,
    ).toBe('2026-08-01');
  });
});

const receipt = (
  overrides: Partial<KcbReceiptEvidence> = {},
): KcbReceiptEvidence => ({
  providerTransactionId: 'FT26274K8QW2',
  amount: 1500,
  currency: 'KES',
  transactionDate: 'Thu Oct 01 14:32:05 EAT 2026',
  matchReason: 'unique_profile_phone',
  source: 'till_notification',
  ...overrides,
});

describe('KCB receipt evidence', () => {
  it('shows an M-Pesa code only for STK receipts', () => {
    expect(kcbMpesaCode(receipt())).toBeUndefined();
    expect(
      kcbMpesaCode(
        receipt({
          providerTransactionId: 'TJ1A7XK2QF',
          source: 'stk_callback',
        }),
      ),
    ).toBe('TJ1A7XK2QF');
  });

  it('shows both codes for Till receipts keyed by the M-Pesa receipt', () => {
    const tillByReceipt = receipt({
      providerTransactionId: 'TJ1A7XK2QF',
      kcbTransactionReference: 'FT26274K8QW2',
    });
    expect(kcbMpesaCode(tillByReceipt)).toBe('TJ1A7XK2QF');
    expect(kcbTransactionReference(tillByReceipt)).toBe('FT26274K8QW2');
    expect(kcbTransactionReference(receipt())).toBe('FT26274K8QW2');
    expect(
      kcbTransactionReference(
        receipt({ providerTransactionId: 'TJ1A7XK2QF', source: 'stk_callback' }),
      ),
    ).toBeUndefined();
  });

  it('prefers the stored M-Pesa receipt and shows FT-keyed Till receipts by KCB ref only', () => {
    expect(
      kcbMpesaCode(
        receipt({ mpesaReceiptNumber: 'TJ1A7XK2QF', providerTransactionId: 'TJ1A7XK2QF' }),
      ),
    ).toBe('TJ1A7XK2QF');
    const ftKeyed = receipt({ kcbTransactionReference: 'FT26274K8QW2' });
    expect(kcbMpesaCode(ftKeyed)).toBeUndefined();
    expect(kcbTransactionReference(ftKeyed)).toBe('FT26274K8QW2');
  });

  it('shows the M-Pesa code from the conversation ID on older Till receipts', () => {
    const legacyTill = receipt({ conversationId: 'TJ1A7XK2QF' });
    expect(kcbMpesaCode(legacyTill)).toBe('TJ1A7XK2QF');
    expect(kcbTransactionReference(legacyTill)).toBe('FT26274K8QW2');
    expect(
      kcbMpesaCode(receipt({ conversationId: 'conversation-1' })),
    ).toBeUndefined();
  });

  it('derives the receipt source for documents written before source existed', () => {
    expect(kcbReceiptSource(receipt({ source: undefined }))).toBe('till');
    expect(
      kcbReceiptSource(
        receipt({ source: undefined, transactionType: 'MPESA_STK' }),
      ),
    ).toBe('stk');
    expect(
      kcbReceiptSource(receipt({ source: undefined, channelCode: 'stk' })),
    ).toBe('stk');
  });

  it('parses both KCB timestamp formats exactly like the backend', () => {
    [
      'Mon May 19 13:30:54 EAT 2025',
      'May 19 13:30:54 EAT 2025',
      '20260813121212',
      '20260101001500',
    ].forEach((value) => {
      expect(parseKcbPaymentTime(value)?.toISOString()).toBe(
        parseKcbTransactionDate(value).toISOString(),
      );
    });
  });

  it('returns no time for unsupported or out-of-range values', () => {
    expect(parseKcbPaymentTime('not-a-date')).toBeUndefined();
    expect(parseKcbPaymentTime('20261301120000')).toBeUndefined();
    expect(parseKcbPaymentTime('Thu Foo 01 14:32:05 EAT 2026')).toBeUndefined();
  });

  it('formats payment times in East Africa Time', () => {
    const paidAt = parseKcbPaymentTime('20261001091544');
    expect(paidAt && formatEatTime(paidAt)).toBe('09:15:44 EAT');
    expect(paidAt && formatEatDate(paidAt)).toContain('1 Oct 2026');
  });

  it('describes the delay between payment and notification', () => {
    const paidAt = new Date('2026-10-01T06:15:44Z');
    expect(formatReceiptDelay(paidAt, new Date('2026-10-01T06:15:47Z'))).toBe(
      '3s later',
    );
    expect(formatReceiptDelay(paidAt, new Date('2026-10-01T06:25:44Z'))).toBe(
      '10 min later',
    );
    expect(
      formatReceiptDelay(paidAt, new Date('2026-10-01T06:15:40Z')),
    ).toBeUndefined();
  });

  it('explains STK amount mismatches and phone match outcomes', () => {
    expect(
      kcbMatchHint(
        receipt({
          amount: 2000,
          requestedAmount: 1000,
          matchReason: 'authenticated_stk_request_mismatch',
          reconciliationWarning: 'payment_details_mismatch',
        }),
      ),
    ).toMatchObject({
      variant: 'error',
      title: 'Amount differs from the STK request',
    });
    expect(
      kcbMatchHint(
        receipt({
          matchReason: 'authenticated_stk_request_mismatch',
          reconciliationWarning: 'merchant_request_id_mismatch',
        }),
      ),
    ).toMatchObject({ title: 'STK request identifiers differ' });
    expect(kcbMatchHint(receipt(), 'Jane Kamau')?.message).toContain(
      'Jane Kamau',
    );
    expect(kcbMatchHint(receipt(), 'Jane Kamau')).toMatchObject({
      title: 'Suggested member',
      message: expect.stringContaining('phone number on their profile'),
    });
    // Notifications stored before profile phone matching keep their reason.
    expect(
      kcbMatchHint(
        receipt({ matchReason: 'unique_verified_phone' }),
        'Jane Kamau',
      ),
    ).toEqual(kcbMatchHint(receipt(), 'Jane Kamau'));
    expect(
      kcbMatchHint(receipt({ matchReason: 'no_verified_phone_match' }))?.title,
    ).toBe('No phone match');
    expect(
      kcbMatchHint(receipt({ matchReason: 'ambiguous_phone_match' }))?.title,
    ).toBe('Several members share this phone');
    expect(kcbMatchHint(receipt({ matchReason: 'other' }))).toBeUndefined();
  });
});

describe('KCB reconciliation member search', () => {
  const jane = memberSearchText({
    firstname: 'Jane',
    lastname: 'Kamau',
    membernumber: '1234/19',
    win: 'WIN-0042',
    phonenumber: '0712345678',
  });

  it('matches names, admission numbers and WINs in any order', () => {
    expect(matchesMemberSearch(jane, 'kamau jane')).toBe(true);
    expect(matchesMemberSearch(jane, 'JAN')).toBe(true);
    expect(matchesMemberSearch(jane, '1234/19')).toBe(true);
    expect(matchesMemberSearch(jane, 'win-0042')).toBe(true);
    expect(matchesMemberSearch(jane, 'jane otieno')).toBe(false);
  });

  it('matches a phone regardless of 07, 254 or +254 prefix', () => {
    ['0712345678', '254712345678', '+254 712 345 678', '712345678'].forEach(
      (query) => expect(matchesMemberSearch(jane, query)).toBe(true),
    );
    expect(matchesMemberSearch(jane, '254722000111')).toBe(false);
  });
});

describe('payments imported from a KCB statement', () => {
  const imported = (overrides: Partial<KcbReceiptEvidence> = {}) =>
    receipt({
      providerTransactionId: 'TD11AAAAAA',
      mpesaReceiptNumber: 'TD11AAAAAA',
      kcbTransactionReference: 'FT25092AAAA1',
      transactionDate: '20250402000000',
      source: 'statement_import',
      ...overrides,
    });

  it('are their own receipt source with both references', () => {
    expect(kcbReceiptSource(imported())).toBe('statement');
    expect(kcbMpesaCode(imported())).toBe('TD11AAAAAA');
    expect(kcbTransactionReference(imported())).toBe('FT25092AAAA1');
  });

  it('describe a phone suggestion as of the import', () => {
    expect(kcbMatchHint(imported(), 'Alice Member')?.message).toBe(
      'Alice Member had this phone number on their profile when the statement was imported. Confirm before reconciling.',
    );
  });

  it('warn when the M-Pesa code is already on a recorded payment', () => {
    expect(
      kcbMatchHint(imported({ referenceCheck: { reason: 'amount_differs' } })),
    ).toEqual({
      variant: 'error',
      title: 'M-Pesa code already on a recorded payment',
      message:
        'A payment carries this code but for a different amount. It was imported on request. Check that it is not already counted before reconciling, or mark it already recorded.',
    });
    expect(
      kcbMatchHint(imported({ referenceCheck: { reason: 'several_members' } }))
        ?.message,
    ).toMatch(/^Payments for several members carry this code\./);
  });
});
