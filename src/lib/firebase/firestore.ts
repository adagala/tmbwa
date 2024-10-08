import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch,
  where,
  collectionGroup,
  limit,
  arrayUnion,
  increment,
  arrayRemove,
} from 'firebase/firestore';
import { db } from './clientApp';
import {
  Member,
  Contribution,
  MemberForm,
  MonthlyStats,
  OwnMemberForm,
  Role,
  Payment,
  PaymentStatusEnum,
} from '@/schemas/member';

type MemberFilters = {
  role?: Role | '';
  memberName?: string;
};

type ContributionsFilters = {
  month: string;
};

type MemberContributionsFilters = {
  memberId: string;
};

export const getMembers = (
  cb: (data: Member[]) => void,
  filters: MemberFilters = {
    role: '',
    memberName: '',
  },
) => {
  const { role, memberName } = filters;
  let q = query(collection(db, 'members'));

  if (role) {
    q = query(q, where('role', '==', role));
  }

  if (memberName) {
    q = query(q, orderBy(`firstnameSearchableIndex.${memberName}`));
  } else {
    q = query(q, orderBy('firstname'));
  }

  const unsubscribe = onSnapshot(
    q,
    { includeMetadataChanges: true },
    (querySnapshot) => {
      const results = querySnapshot.docs.map((doc) => {
        return {
          member_id: doc.id,
          ...doc.data(),
        } as Member;
      });
      cb(results);
    },
  );
  return unsubscribe;
};

export const getMemberById = (
  memberId: string,
  cb: (data: Member | null) => void,
) => {
  const memberRef = doc(db, 'members', memberId);
  const unsubscribe = onSnapshot(
    memberRef,
    { includeMetadataChanges: true },
    (memberSnapshot) => {
      if (memberSnapshot.exists()) {
        const memberData = {
          member_id: memberSnapshot.id,
          ...memberSnapshot.data(),
        } as Member;
        cb(memberData);
      } else {
        cb(null);
      }
    },
    (error) => {
      console.error('Error getting document:', error);
      cb(null);
    },
  );

  return unsubscribe;
};

export const addMember = (member: MemberForm) => {
  const membersRef = collection(db, 'members');
  const newMember: Partial<Member> = { ...member, balance: 0 };
  return addDoc(membersRef, newMember);
};

export const updateMember = (
  memberId: string,
  member: MemberForm | OwnMemberForm,
) => {
  const memberRef = doc(db, 'members', memberId);
  return updateDoc(memberRef, member);
};

export const updateMembershipFees = (memberId: string, member: Member) => {
  const memberRef = doc(db, 'members', memberId);
  const _member: Partial<Member> = { isFeesPaid: !member.isFeesPaid };
  return updateDoc(memberRef, _member);
};

export const deleteMember = (memberId: string) => {
  const memberRef = doc(db, 'members', memberId);
  return deleteDoc(memberRef);
};

export const getMonthlyStats = (cb: (data: MonthlyStats[]) => void) => {
  const statsQuery = query(
    collection(db, 'monthly_stats'),
    orderBy('month', 'asc'),
    limit(10),
  );

  const unsubscribe = onSnapshot(
    statsQuery,
    { includeMetadataChanges: true },
    (querySnapshot) => {
      const stats = querySnapshot.docs.map((doc) => {
        return doc.data() as MonthlyStats;
      });
      cb(stats);
    },
  );
  return unsubscribe;
};

export const getMonthlyMembersContributions = (
  cb: (data: Contribution[]) => void,
  filters: ContributionsFilters,
) => {
  const { month } = filters;
  const contributionsQuery = query(
    collectionGroup(db, 'contributions'),
    where('month', '==', month),
    orderBy('firstname'),
  );

  const unsubscribe = onSnapshot(
    contributionsQuery,
    { includeMetadataChanges: true },
    (querySnapshot) => {
      const contributions = querySnapshot.docs.map((doc) => {
        return {
          contribution_id: doc.id,
          ...doc.data(),
        } as Contribution;
      });
      cb(contributions);
    },
  );
  return unsubscribe;
};

export const getMemberContributions = (
  cb: (data: Contribution[]) => void,
  filters: MemberContributionsFilters,
) => {
  const { memberId } = filters;
  const memberContributionQuery = query(
    collection(db, `members/${memberId}/contributions`),
    orderBy('month', 'asc'),
  );

  const unsubscribe = onSnapshot(
    memberContributionQuery,
    { includeMetadataChanges: true },
    (querySnapshot) => {
      const contributions = querySnapshot.docs.map((doc) => {
        return {
          contribution_id: doc.id,
          ...doc.data(),
        } as Contribution;
      });
      cb(contributions);
    },
  );
  return unsubscribe;
};

export const addPayment = async ({
  contribution,
  payment,
}: {
  contribution: Contribution;
  payment: Payment;
}) => {
  const batch = writeBatch(db);
  const memberId = contribution.member_id;
  const contributionBalance =
    payment.amount > contribution.balance
      ? contribution.balance
      : payment.amount;

  // add payment
  const paymentsRef = collection(db, `members/${memberId}/payments`);
  const paymentId = doc(paymentsRef).id;
  const paymentRef = doc(db, `members/${memberId}/payments/${paymentId}`);
  const newPayment: Payment = {
    ...payment,
    payment_id: paymentId,
    contribution_amount: contributionBalance,
  };
  batch.set(paymentRef, newPayment);

  // update payments field in the contribution
  const contributionRef = doc(
    db,
    `members/${memberId}/contributions/${contribution.month}`,
  );
  const contributionUpdate = {
    payments: arrayUnion(newPayment),
    balance: increment(-contributionBalance),
    paid:
      contribution.balance - payment.amount > 0
        ? PaymentStatusEnum.Enum.partial
        : PaymentStatusEnum.Enum.paid,
  };
  batch.set(contributionRef, contributionUpdate, { merge: true });

  // update member balance
  const memberRef = doc(db, `members/${memberId}`);
  batch.set(
    memberRef,
    {
      balance: increment(payment.amount),
      contributionBalance: increment(contributionBalance),
    },
    { merge: true },
  );

  // update stat for that month
  const statRef = doc(db, `monthly_stats/${contribution.month}`);
  batch.set(
    statRef,
    { contribution: increment(contributionBalance) },
    { merge: true },
  );

  return batch.commit();
};

export const deletePayment = async ({
  contribution,
  payment,
}: {
  contribution: Contribution;
  payment: Payment;
}) => {
  const batch = writeBatch(db);
  const memberId = contribution.member_id;

  // remove payment
  const paymentRef = doc(
    db,
    `members/${memberId}/payments/${payment.payment_id}`,
  );
  batch.delete(paymentRef);

  // update payments field in the contribution
  const contributionRef = doc(
    db,
    `members/${memberId}/contributions/${contribution.month}`,
  );
  batch.set(
    contributionRef,
    {
      payments: arrayRemove(payment),
      balance: increment(payment.contribution_amount),
      paid:
        contribution.amount - (payment.amount + contribution.balance) > 0
          ? PaymentStatusEnum.Enum.partial
          : PaymentStatusEnum.Enum.unpaid,
    },
    { merge: true },
  );

  // update member balance
  const memberRef = doc(db, `members/${memberId}`);
  batch.set(
    memberRef,
    { balance: increment(-payment.amount) },
    { merge: true },
  );

  // update stat for that month
  const statRef = doc(db, `monthly_stats/${contribution.month}`);
  batch.set(
    statRef,
    { contribution: increment(-payment.contribution_amount) },
    { merge: true },
  );

  return batch.commit();
};

export const getRecentPayments = (cb: (data: Payment[]) => void) => {
  let q = query(
    collectionGroup(db, 'payments'),
    orderBy('paymentdate', 'desc'),
    limit(5),
  );

  const unsubscribe = onSnapshot(
    q,
    { includeMetadataChanges: true },
    (querySnapshot) => {
      const payments = querySnapshot.docs.map((doc) => {
        return doc.data() as Payment;
      });
      cb(payments);
    },
  );
  return unsubscribe;
};
