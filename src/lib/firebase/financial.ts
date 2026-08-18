import { httpsCallable } from 'firebase/functions';
import { functions } from './clientApp';
import { Contribution, Member, Payment } from 'tmbwa-shared/firebase';

const pendingRequests = new Map<string, string>();

const call = async (name: string, data: Record<string, unknown>) => {
  const operation = `${name}:${JSON.stringify(data)}`;
  const requestId = pendingRequests.get(operation) ?? crypto.randomUUID();
  pendingRequests.set(operation, requestId);
  try {
    const result = await httpsCallable(functions, name)({ requestId, ...data });
    pendingRequests.delete(operation);
    return result;
  } catch (error) {
    const code = (error as { code?: string }).code ?? '';
    if (
      ![
        'functions/unavailable',
        'functions/deadline-exceeded',
        'functions/internal',
      ].includes(code)
    ) {
      pendingRequests.delete(operation);
    }
    throw error;
  }
};

export const deletePayment = ({
  contribution,
  payment,
}: {
  contribution: Contribution;
  payment: Payment;
}) =>
  call('reverseContributionPayment', {
    memberId: contribution.member_id,
    paymentId: payment.payment_id,
  });

export const addContribution = ({
  month,
  member,
}: {
  uid: string;
  month: string;
  member: Member;
}) => call('createContribution', { memberId: member.member_id, month });

export const deleteContribution = ({
  contribution,
  member,
}: {
  contribution: Contribution;
  member: Member;
}) =>
  call('removeContribution', {
    memberId: member.member_id,
    contributionId: contribution.month,
  });

export const correctLegacyContribution = ({
  contribution,
  correctedPaidAmount,
  reason,
  reference,
  notes,
  originalPaymentDate,
}: {
  contribution: Contribution;
  correctedPaidAmount: number;
  reason: string;
  reference?: string;
  notes?: string;
  originalPaymentDate?: string;
}) =>
  call('correctLegacyContribution', {
    memberId: contribution.member_id,
    contributionId: contribution.month,
    correctedPaidAmount,
    reason,
    reference,
    notes,
    originalPaymentDateMillis: originalPaymentDate
      ? new Date(`${originalPaymentDate}T12:00:00`).getTime()
      : undefined,
  });

export const reverseLegacyContributionCorrection = ({
  memberId,
  correctionId,
  reason,
}: {
  memberId: string;
  correctionId: string;
  reason: string;
}) =>
  call('reverseLegacyContributionCorrection', {
    memberId,
    correctionId,
    reason,
  });

export const transitionMemberStatus = ({
  memberId,
  status,
}: {
  memberId: string;
  status: string;
}) => call('transitionMemberStatus', { memberId, status });
