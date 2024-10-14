import { FieldValue, Timestamp } from 'firebase-admin/firestore';

export type Member = {
  firstname: string;
  lastname: string;
  email: string;
  role: ROLE;
  membernumber: string;
  win: string;
  phonenumber: string;
  status: STATUS;
  gender: GENDER;
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
};

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
  paid: PAYMENT_STATUS;
  amount: number;
  balance: number;
  createdat: Date | Timestamp;
  month: string;
  payments: Payment[] | FieldValue;
};

export type MemberContributionWithId = MemberContribution & {
  contribution_id: string;
};

export type Contribution = Member & MemberContribution;

export enum STATUS {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}

export enum ROLE {
  MEMBER = 'member',
  ADMINISTRATOR = 'administrator',
}

export enum GENDER {
  MALE = 'male',
  FEMALE = 'female',
}

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

export const roles = ['member', 'administrator'] as const;

export const paymentStatus = ['paid', 'unpaid'] as const;
