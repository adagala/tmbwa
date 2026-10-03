import { describe, expect, it } from 'vitest';
import { normalizeMpesaReference, paymentDocumentSchema } from 'tmbwa-shared';
import {
  referenceNormalizedChange,
  sharedReferences,
  withReferenceNormalized,
} from '../functions/src/payments/reference';

describe('M-Pesa reference normalization', () => {
  it('normalizes hand-typed codes to the form KCB statements report', () => {
    for (const value of ['TD11AAAAAA', 'td11aaaaaa', ' TD11AAAAAA ', 'TD11 AAAAAA', 'td 11\taaa aaa\n']) {
      expect(normalizeMpesaReference(value)).toBe('TD11AAAAAA');
    }
  });

  it('has no normalized form for references that are not M-Pesa codes', () => {
    for (const value of [
      'BALANCE B/F', 'TMBWA-ABCDEF123456', 'TD11-AAAAAA', 'TD11AAA', '', '   ', 'A'.repeat(21), undefined, null, 1234567890,
    ]) {
      expect(normalizeMpesaReference(value)).toBeUndefined();
    }
  });
});

describe('payment referenceNormalized', () => {
  it('sets the field from referencenumber when written', () => {
    expect(withReferenceNormalized({ payment_id: 'p1', referencenumber: 'td11 aaaaaa' }))
      .toEqual({ payment_id: 'p1', referencenumber: 'td11 aaaaaa', referenceNormalized: 'TD11AAAAAA' });
  });

  it('ignores the internal receipt number', () => {
    expect(withReferenceNormalized({ referencenumber: 'BALANCE B/F', receipt_number: 'TMBWA-P1' }))
      .toEqual({ referencenumber: 'BALANCE B/F', receipt_number: 'TMBWA-P1' });
  });

  it('never keeps a caller-supplied value that disagrees with referencenumber', () => {
    expect(withReferenceNormalized({ referencenumber: 'TD11AAAAAA', referenceNormalized: 'TD99ZZZZZZ' }))
      .toEqual({ referencenumber: 'TD11AAAAAA', referenceNormalized: 'TD11AAAAAA' });
    expect(withReferenceNormalized({ referencenumber: 'BALANCE B/F', referenceNormalized: 'TD99ZZZZZZ' }))
      .toEqual({ referencenumber: 'BALANCE B/F' });
  });

  it('is accepted by the payment schema', () => {
    const payment = paymentDocumentSchema.parse({
      payment_id: 'p1',
      referencenumber: 'td11 aaaaaa',
      referenceNormalized: 'TD11AAAAAA',
      amount: 500,
      paymentdate: new Date('2025-04-01'),
      member_id: 'member-a',
      contribution_id: '2025-04-01',
      firstname: 'Test',
      lastname: 'Member',
      contribution_amount: 500,
    });
    expect(payment.referenceNormalized).toBe('TD11AAAAAA');
  });
});

describe('referenceNormalized backfill guard', () => {
  it('sets the field when it is missing or stale', () => {
    expect(referenceNormalizedChange({ referencenumber: 'td11aaaaaa' })).toEqual({ action: 'set', value: 'TD11AAAAAA' });
    expect(referenceNormalizedChange({ referencenumber: 'TD11AAAAAA', referenceNormalized: 'TD99ZZZZZZ' }))
      .toEqual({ action: 'set', value: 'TD11AAAAAA' });
  });

  it('writes nothing when the field already matches, so re-runs are no-ops', () => {
    expect(referenceNormalizedChange({ referencenumber: 'TD11 AAAAAA', referenceNormalized: 'TD11AAAAAA' })).toBeUndefined();
  });

  it('removes the field for a non-code reference and writes nothing when it is already absent', () => {
    expect(referenceNormalizedChange({ referencenumber: 'BALANCE B/F', referenceNormalized: 'TD11AAAAAA' }))
      .toEqual({ action: 'remove' });
    expect(referenceNormalizedChange({ referencenumber: 'BALANCE B/F' })).toBeUndefined();
    expect(referenceNormalizedChange(undefined)).toBeUndefined();
  });
});

describe('shared references', () => {
  it('reports normalized references held by more than one payment', () => {
    expect(sharedReferences([
      { path: 'members/a/payments/1', referenceNormalized: 'TD11AAAAAA' },
      { path: 'members/b/payments/2', referenceNormalized: 'TD11AAAAAA' },
      { path: 'members/a/payments/3', referenceNormalized: 'TD22BBBBBB' },
      { path: 'members/a/payments/4', referenceNormalized: undefined },
      { path: 'members/b/payments/5', referenceNormalized: undefined },
    ])).toEqual([['members/a/payments/1', 'members/b/payments/2']]);
  });
});
