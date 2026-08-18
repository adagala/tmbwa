import { PAYMENT_STATUS } from 'tmbwa-shared';

export type PaymentAllocation = { contributionId: string; amount: number };

export const availableUnreservedBalance = (balance: number, reservedCredit: number) => {
  if (!Number.isFinite(balance) || !Number.isFinite(reservedCredit) || reservedCredit < 0) {
    throw new Error('Invalid account balance.');
  }
  return Math.max(balance - reservedCredit, 0);
};

export const reservableLegacyKcbCredit = (
  receiptCredit: number,
  memberBalance: number,
  outstandingContributions: number,
  alreadyReserved: number,
) => Math.min(
  receiptCredit,
  Math.max(memberBalance + outstandingContributions - alreadyReserved, 0),
);

export const recoverableOutstandingBalance = (
  contributions: Array<{ balance?: unknown }>,
) => contributions.reduce((sum, contribution) => {
  const balance = Number(contribution.balance);
  return sum + (Number.isFinite(balance) && balance > 0 ? balance : 0);
}, 0);

export const legacyContributionCorrection = (
  contributionAmount: number,
  currentBalance: number,
  correctedPaidAmount: number,
) => {
  if (!Number.isFinite(contributionAmount) || contributionAmount <= 0) {
    throw new Error('Contribution amount must be positive.');
  }
  if (
    !Number.isFinite(currentBalance) || currentBalance < 0 ||
    !Number.isFinite(correctedPaidAmount) || correctedPaidAmount < 0 ||
    correctedPaidAmount > contributionAmount
  ) {
    throw new Error('Corrected paid amount must be between zero and the contribution amount.');
  }
  const currentPaidAmount = contributionAmount - currentBalance;
  const correctedBalance = contributionAmount - correctedPaidAmount;
  const delta = correctedPaidAmount - currentPaidAmount;
  return {
    currentPaidAmount,
    correctedPaidAmount,
    correctedBalance,
    delta,
    status: correctedBalance === 0
      ? PAYMENT_STATUS.PAID
      : correctedPaidAmount > 0 ? PAYMENT_STATUS.PARTIAL : PAYMENT_STATUS.UNPAID,
  };
};

export const hasLegacyCorrectionHistory = (corrections: unknown) =>
  Array.isArray(corrections) && corrections.length > 0;

export const hasLinkedPaymentHistory = (payments: unknown) =>
  Array.isArray(payments) && payments.length > 0;

export const legacyInventoryCursor = (value: unknown) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (
    typeof value !== 'string' ||
    !/^members\/[^/]+\/contributions\/[^/]+$/.test(value)
  ) {
    throw new Error('Invalid legacy inventory cursor.');
  }
  return value;
};

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

export const requiresReceiptReversalBeforeContributionRemoval = (payment: {
  provider_transaction_id?: unknown;
  allocations?: Array<{ contribution_id: string; amount: number }>;
  contribution_id?: string;
  contribution_amount?: number;
}) =>
  typeof payment.provider_transaction_id === 'string' ||
  paymentAllocations(payment).length > 1;

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
