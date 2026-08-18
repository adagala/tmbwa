import { httpsCallable } from 'firebase/functions';
import { functions } from './clientApp';
import { Contribution, Member, Payment } from 'tmbwa-shared/firebase';
import { MemberBalanceForm } from 'tmbwa-shared';

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

export const addPayment = ({
  contribution,
  payment,
}: {
  contribution: Contribution;
  payment: Payment;
}) =>
  call('recordContributionPayment', {
    memberId: contribution.member_id,
    contributionId: contribution.month,
    referenceNumber: payment.referencenumber,
    amount: payment.amount,
    paymentDateMillis:
      payment.paymentdate instanceof Date
        ? payment.paymentdate.getTime()
        : 'seconds' in payment.paymentdate
          ? payment.paymentdate.seconds * 1000
          : Date.now(),
  });

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

export const updateMemberBalance = ({
  member,
  balanceForm,
}: {
  uid: string;
  member: Member;
  balanceForm: MemberBalanceForm;
}) =>
  call('adjustMemberBalance', {
    memberId: member.member_id,
    amount: balanceForm.amount,
    type: balanceForm.type,
  });

export const transitionMemberStatus = ({
  memberId,
  status,
}: {
  memberId: string;
  status: string;
}) => call('transitionMemberStatus', { memberId, status });
