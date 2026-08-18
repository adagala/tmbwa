import { PAYMENT_STATUS } from 'tmbwa-shared';

export type PaymentAllocation = { contributionId: string; amount: number };

export const validatePaymentAllocations = (
  receiptAmount: number,
  allocations: PaymentAllocation[],
  outstandingByContribution: Record<string, number>,
) => {
  if (!Number.isFinite(receiptAmount) || receiptAmount <= 0) {
    throw new Error('Payment must be positive.');
  }
  const seen = new Set<string>();
  let allocatedAmount = 0;
  allocations.forEach(({ contributionId, amount }) => {
    if (!contributionId || seen.has(contributionId)) {
      throw new Error('Each contribution can be selected only once.');
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Allocation amounts must be positive.');
    }
    const outstanding = outstandingByContribution[contributionId];
    if (!Number.isFinite(outstanding) || outstanding <= 0) {
      throw new Error('A selected contribution is already paid or missing.');
    }
    if (amount > outstanding) {
      throw new Error('An allocation exceeds the contribution balance.');
    }
    seen.add(contributionId);
    allocatedAmount += amount;
  });
  if (allocatedAmount > receiptAmount) {
    throw new Error('Allocations exceed the available receipt amount.');
  }
  return { allocatedAmount, unallocatedAmount: receiptAmount - allocatedAmount };
};

export const paymentAllocations = (payment: {
  allocations?: Array<{ contribution_id: string; amount: number }>;
  contribution_id?: string;
  contribution_amount?: number;
}) => payment.allocations?.length
  ? payment.allocations.map((item) => ({
    contributionId: item.contribution_id,
    amount: Number(item.amount),
  }))
  : payment.contribution_id && Number(payment.contribution_amount) > 0
    ? [{
        contributionId: payment.contribution_id,
        amount: Number(payment.contribution_amount),
      }]
    : [];

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
