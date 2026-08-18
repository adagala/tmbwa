import { describe, expect, it } from 'vitest';
import {
  applyBalanceAdjustment,
  availableUnreservedBalance,
  applyPayment,
  paymentAllocations,
  requiresReceiptReversalBeforeContributionRemoval,
  reservableLegacyKcbCredit,
  reversePayment,
  validatePaymentAllocations,
} from '../functions/src/financial/domain';

describe('financial invariants', () => {
  it('applies a partial payment without creating credit', () => {
    expect(applyPayment(200, 500)).toEqual({
      contributionAmount: 200,
      accountCredit: 0,
      remainingBalance: 300,
      status: 'partial',
    });
  });

  it('caps the contribution portion and preserves overpayment as account credit', () => {
    expect(applyPayment(700, 500)).toEqual({
      contributionAmount: 500,
      accountCredit: 200,
      remainingBalance: 0,
      status: 'paid',
    });
  });

  it('rejects zero, negative, and already-paid contribution payments', () => {
    expect(() => applyPayment(0, 500)).toThrow();
    expect(() => applyPayment(-1, 500)).toThrow();
    expect(() => applyPayment(100, 0)).toThrow();
  });

  it('restores unpaid and partial states on reversal', () => {
    expect(reversePayment(0, 500, 500)).toEqual({
      restoredBalance: 500,
      status: 'unpaid',
    });
    expect(reversePayment(100, 200, 500)).toEqual({
      restoredBalance: 300,
      status: 'partial',
    });
  });

  it('prevents account deductions below zero', () => {
    expect(applyBalanceAdjustment(500, 200, 'deduction')).toBe(300);
    expect(applyBalanceAdjustment(500, 200, 'top_up')).toBe(700);
    expect(() => applyBalanceAdjustment(100, 200, 'deduction')).toThrow();
  });

  it('keeps reserved KCB credit unavailable to generic balance operations', () => {
    expect(availableUnreservedBalance(100, 600)).toBe(0);
    expect(availableUnreservedBalance(700, 600)).toBe(100);
  });

  it('caps legacy KCB credit at funds that have not already been consumed', () => {
    expect(reservableLegacyKcbCredit(600, 100, 500, 0)).toBe(600);
    expect(reservableLegacyKcbCredit(600, -400, 900, 0)).toBe(500);
    expect(reservableLegacyKcbCredit(600, 100, 500, 200)).toBe(400);
  });

  it('validates explicit multi-contribution allocations and credit', () => {
    expect(
      validatePaymentAllocations(
        1000,
        [
          { contributionId: 'june', amount: 400 },
          { contributionId: 'march', amount: 500 },
        ],
        { june: 400, march: 500 },
      ),
    ).toEqual({
      allocatedAmount: 900,
      unallocatedAmount: 100,
    });
    expect(validatePaymentAllocations(1000, [], {})).toEqual({
      allocatedAmount: 0,
      unallocatedAmount: 1000,
    });
  });

  it('rejects duplicate, excessive, and over-balance allocations', () => {
    expect(() =>
      validatePaymentAllocations(
        1000,
        [
          { contributionId: 'june', amount: 100 },
          { contributionId: 'june', amount: 100 },
        ],
        { june: 400 },
      ),
    ).toThrow('only once');
    expect(() =>
      validatePaymentAllocations(
        500,
        [{ contributionId: 'june', amount: 501 }],
        { june: 600 },
      ),
    ).toThrow('available receipt');
    expect(() =>
      validatePaymentAllocations(
        1000,
        [{ contributionId: 'june', amount: 401 }],
        { june: 400 },
      ),
    ).toThrow('contribution balance');
  });

  it('derives legacy and explicit allocations for reversal', () => {
    expect(
      paymentAllocations({
        contribution_id: 'june',
        contribution_amount: 400,
      }),
    ).toEqual([{ contributionId: 'june', amount: 400 }]);
    expect(
      paymentAllocations({
        allocations: [
          { contribution_id: 'june', amount: 400 },
          { contribution_id: 'march', amount: 500 },
        ],
      }),
    ).toHaveLength(2);
    expect(
      paymentAllocations({ contribution_id: '', contribution_amount: 0 }),
    ).toEqual([]);
  });

  it('requires receipt reversal before deleting shared or KCB contributions', () => {
    expect(
      requiresReceiptReversalBeforeContributionRemoval({
        provider_transaction_id: 'KCB-1',
        contribution_id: 'june',
        contribution_amount: 400,
      }),
    ).toBe(true);
    expect(
      requiresReceiptReversalBeforeContributionRemoval({
        allocations: [
          { contribution_id: 'june', amount: 400 },
          { contribution_id: 'march', amount: 500 },
        ],
      }),
    ).toBe(true);
    expect(
      requiresReceiptReversalBeforeContributionRemoval({
        contribution_id: 'june',
        contribution_amount: 400,
      }),
    ).toBe(false);
  });
});
