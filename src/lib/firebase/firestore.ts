import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  collectionGroup,
  limit,
  getDocs,
  OrderByDirection,
  QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from './clientApp';
import {
  Member,
  Contribution,
  MemberForm,
  OwnMemberForm,
  Payment,
  memberFormSchema,
  memberSchema,
  ownMemberFormSchema,
  parseContributionDocument,
  parseMemberDocument,
  parsePaymentDocument,
} from 'tmbwa-shared/firebase';
import {
  MemberRole,
  MEMBER_STATUS,
  MonthlyStats,
  Role,
  memberRoles,
  monthlyStatsSchema,
  normalizeRoles,
  parseDocument,
  sameRoles,
} from 'tmbwa-shared';
import { User } from 'firebase/auth';

// Accounts (e.g. system or test accounts) hidden from member, contribution and
// payment listings. Display-only: this is not an authorization boundary.
const hiddenMemberIds = new Set(
  (import.meta.env.VITE_HIDDEN_MEMBER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
);

const isVisibleMember = (memberId: string | undefined) =>
  !memberId || !hiddenMemberIds.has(memberId);

// Subcollection docs live at members/{memberId}/<subcollection>/{docId}.
const isVisibleMemberDoc = (snapshot: QueryDocumentSnapshot) =>
  isVisibleMember(snapshot.ref.parent.parent?.id);

type MemberFilters = {
  role?: MemberRole | '';
  memberName?: string;
};

type ContributionsFilters = {
  month: string;
};

type MemberContributionsFilters = {
  memberId: string;
};

type MonthlyStatsFilters = {
  direction?: OrderByDirection;
  max?: number;
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
      const results = querySnapshot.docs
        .filter((snapshot) => isVisibleMember(snapshot.id))
        .map((snapshot) => parseMemberDocument(snapshot.id, snapshot.data()));
      cb(results);
    },
  );
  return unsubscribe;
};

export const getMemberById = (
  memberId: string,
  cb: (data: Member | null) => void,
  user?: { role: MemberRole; roles?: Role[]; user: User },
) => {
  const memberRef = doc(db, 'members', memberId);
  const unsubscribe = onSnapshot(
    memberRef,
    { includeMetadataChanges: true },
    async (memberSnapshot) => {
      if (memberSnapshot.exists()) {
        const memberData = parseMemberDocument(
          memberSnapshot.id,
          memberSnapshot.data(),
        );
        cb(memberData);
        // Refresh the token when the member's roles changed, so claims and
        // the interface catch up with the server-owned record.
        if (
          user &&
          (memberData.role !== user.role ||
            (user.roles &&
              !sameRoles(memberRoles(memberData), normalizeRoles(user.roles))))
        ) {
          await user.user.getIdToken(true);
        }
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

export const memberEmailExists = async (email: string) => {
  const collectionRef = collection(db, 'members');
  const memberQuery = query(collectionRef, where('email', '==', email));
  const snapshot = await getDocs(memberQuery);
  return snapshot.docs.length > 0;
};

export const addMember = (member: MemberForm) => {
  const membersRef = collection(db, 'members');
  const form = memberFormSchema.parse(member);
  const newMember = memberSchema.omit({ member_id: true }).parse({
    ...form,
    status: MEMBER_STATUS.ACTIVE,
    balance: 0,
    contributionBalance: 0,
  });
  return addDoc(membersRef, newMember);
};

export const updateMember = (
  memberId: string,
  member: MemberForm | OwnMemberForm,
) => {
  const memberRef = doc(db, 'members', memberId);
  const update =
    'email' in member
      ? memberFormSchema.parse(member)
      : ownMemberFormSchema.parse(member);
  return updateDoc(memberRef, update);
};

export const updateMembershipFees = (memberId: string, member: Member) => {
  const memberRef = doc(db, 'members', memberId);
  const _member: Partial<Member> = { isFeesPaid: !member.isFeesPaid };
  return updateDoc(memberRef, _member);
};

export const getMonthlyStats = (
  cb: (data: MonthlyStats[]) => void,
  { direction, max }: MonthlyStatsFilters,
) => {
  direction = direction || 'desc';
  let statsQuery = query(
    collection(db, 'monthly_stats'),
    orderBy('month', direction),
  );

  if (max) {
    statsQuery = query(statsQuery, limit(max));
  }

  const unsubscribe = onSnapshot(
    statsQuery,
    { includeMetadataChanges: true },
    (querySnapshot) => {
      const stats = querySnapshot.docs.map((snapshot) =>
        parseDocument(monthlyStatsSchema, snapshot.data(), snapshot.ref.path),
      );
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
      const contributions = querySnapshot.docs
        .filter(isVisibleMemberDoc)
        .map((snapshot) =>
          parseContributionDocument(snapshot.id, snapshot.data()),
        );
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
    orderBy('month', 'desc'),
  );

  const unsubscribe = onSnapshot(
    memberContributionQuery,
    { includeMetadataChanges: true },
    (querySnapshot) => {
      const contributions = querySnapshot.docs.map((snapshot) =>
        parseContributionDocument(snapshot.id, snapshot.data()),
      );
      cb(contributions);
    },
  );
  return unsubscribe;
};

export const getMemberPayments = (
  cb: (data: Payment[]) => void,
  filters: MemberContributionsFilters,
) => {
  const { memberId } = filters;
  const memberPaymentsQuery = query(
    collection(db, `members/${memberId}/payments`),
    orderBy('paymentdate', 'desc'),
  );

  const unsubscribe = onSnapshot(
    memberPaymentsQuery,
    { includeMetadataChanges: true },
    (querySnapshot) => {
      const payments = querySnapshot.docs.map((snapshot) =>
        parsePaymentDocument(snapshot.id, snapshot.data()),
      );
      cb(payments);
    },
  );
  return unsubscribe;
};

export const getRecentPayments = (cb: (data: Payment[]) => void) => {
  const q = query(
    collectionGroup(db, 'payments'),
    orderBy('paymentdate', 'desc'),
    limit(5),
  );

  const unsubscribe = onSnapshot(
    q,
    { includeMetadataChanges: true },
    (querySnapshot) => {
      const payments = querySnapshot.docs
        .filter(isVisibleMemberDoc)
        .map((snapshot) => parsePaymentDocument(snapshot.id, snapshot.data()));
      cb(payments);
    },
  );
  return unsubscribe;
};

export const getAllContributions = (
  cb: (data: Contribution[]) => void,
  onError?: (error: Error) => void,
) =>
  onSnapshot(
    query(collectionGroup(db, 'contributions'), orderBy('month', 'desc')),
    (snapshot) =>
      cb(
        snapshot.docs
          .filter(isVisibleMemberDoc)
          .map((item) => parseContributionDocument(item.id, item.data())),
      ),
    onError,
  );

export const getAllPayments = (
  cb: (data: Payment[]) => void,
  onError?: (error: Error) => void,
) =>
  onSnapshot(
    query(collectionGroup(db, 'payments'), orderBy('paymentdate', 'desc')),
    (snapshot) =>
      cb(
        snapshot.docs
          .filter(isVisibleMemberDoc)
          .map((item) => parsePaymentDocument(item.id, item.data())),
      ),
    onError,
  );
