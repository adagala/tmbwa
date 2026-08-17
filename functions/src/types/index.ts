import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  MemberStatus,
  Gender as SharedGender,
  MemberFormBase,
  MonthlyStats as SharedMonthlyStats,
  PaymentStatus as SharedPaymentStatus,
} from 'tmbwa-shared';

export interface Member extends MemberFormBase {
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

export type Stats = {
  totalMembers: number | FieldValue;
};

export type MonthlyStats = Omit<
  SharedMonthlyStats,
  'amount' | 'newMembers' | 'totalMembers'
> & {
  amount: number | FieldValue;
  newMembers: number | FieldValue;
  totalMembers: number | FieldValue;
};
