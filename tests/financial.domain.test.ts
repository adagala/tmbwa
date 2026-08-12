import { describe, expect, it } from 'vitest';
import { applyBalanceAdjustment, applyPayment, reversePayment } from '../functions/src/financial/domain';

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
    expect(reversePayment(0, 500, 500)).toEqual({ restoredBalance: 500, status: 'unpaid' });
    expect(reversePayment(100, 200, 500)).toEqual({ restoredBalance: 300, status: 'partial' });
  });

  it('prevents account deductions below zero', () => {
    expect(applyBalanceAdjustment(500, 200, 'deduction')).toBe(300);
    expect(applyBalanceAdjustment(500, 200, 'top_up')).toBe(700);
    expect(() => applyBalanceAdjustment(100, 200, 'deduction')).toThrow();
  });
});
