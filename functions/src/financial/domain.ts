import { PAYMENT_STATUS } from '../types';

export const applyPayment = (amount: number, outstanding: number) => {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payment must be positive.');
  if (!Number.isFinite(outstanding) || outstanding <= 0) throw new Error('Contribution is paid.');
  const contributionAmount = Math.min(amount, outstanding);
  const remainingBalance = outstanding - contributionAmount;
  return {
    contributionAmount,
    accountCredit: amount - contributionAmount,
    remainingBalance,
    status: remainingBalance === 0 ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.PARTIAL,
  };
};

export const reversePayment = (currentBalance: number, contributionAmount: number, contributionTotal: number) => {
  const restoredBalance = currentBalance + contributionAmount;
  return {
    restoredBalance,
    status: restoredBalance >= contributionTotal ? PAYMENT_STATUS.UNPAID : PAYMENT_STATUS.PARTIAL,
  };
};

export const applyBalanceAdjustment = (currentBalance: number, amount: number, type: string) => {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be positive.');
  if (type !== 'top_up' && type !== 'deduction') throw new Error('Invalid adjustment type.');
  const nextBalance = currentBalance + (type === 'top_up' ? amount : -amount);
  if (nextBalance < 0) throw new Error('Deduction exceeds account balance.');
  return nextBalance;
};
