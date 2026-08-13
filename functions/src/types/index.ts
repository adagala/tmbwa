import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  member_roles,
  member_status,
  genders,
  contribution_status,
  MemberRole,
  MemberStatus,
  Gender as SharedGender,
  PaymentStatus as SharedPaymentStatus,
} from 'tmbwa-shared';

export {
  member_roles,
  member_status,
  genders,
  contribution_status,
};
export type { MemberRole, MemberStatus };

export interface Member {
  firstname: string;
  lastname: string;
  email: string;
  role: MemberRole;
  membernumber: string;
  win: string;
  phonenumber: string;
  status: MemberStatus;
  gender: SharedGender;
  createat: Timestamp;
  firstnameSearchableIndex: {
    [key: string]: boolean;
  };
  lastnameSearchableIndex: {
    [key: string]: boolean;
  };
  balance: number | FieldValue;
  contributionBalance: number | FieldValue;
  isFeesPaid: boolean;
}

export type MemberWithId = Member & { member_id: string };

export type Payment = {
  payment_id: string;
  referencenumber: string;
  amount: number;
  paymentdate: Date | Timestamp;
  member_id: string;
  contribution_id: string;
  firstname: string;
  lastname: string;
  contribution_amount: number;
};

export type PaymentWithId = Payment & { payment_id: string };

export type MemberContribution = {
  paid: SharedPaymentStatus;
  amount: number;
  balance: number;
  createdat: Date | Timestamp;
  month: string;
  payments: Payment[] | FieldValue;
};

export type MemberContributionWithId = MemberContribution & {
  contribution_id: string;
};

export type Contribution = MemberWithId & MemberContribution;

/** @deprecated Use MemberStatus from tmbwa-shared */
export enum STATUS {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}

/** @deprecated Use MemberRole from tmbwa-shared */
export enum ROLE {
  MEMBER = 'member',
  ADMINISTRATOR = 'administrator',
}

/** @deprecated Use Gender from tmbwa-shared */
export enum GENDER {
  MALE = 'male',
  FEMALE = 'female',
}

/** @deprecated Use PaymentStatus from tmbwa-shared */
export enum PAYMENT_STATUS {
  PAID = 'paid',
  UNPAID = 'unpaid',
  PARTIAL = 'partial',
}

export type Stats = {
  totalMembers: number | FieldValue;
};

export type MonthlyStats = {
  amount: number | FieldValue;
  contribution: number;
  paymentsCount: number;
  month: string;
  newMembers: number | FieldValue;
  totalMembers: number | FieldValue;
};

export const roles = member_roles;

export const paymentStatus = ['paid', 'unpaid'] as const;

