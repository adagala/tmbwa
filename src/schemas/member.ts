// schemas/memberSchema.ts
import { z } from 'zod';
import { isMobilePhone } from 'validator';
import { years } from '@/lib/utils';
import { FieldValue } from 'firebase/firestore';

export const member_roles = ['member', 'administrator'] as const;
export const contribution_status = ['paid', 'unpaid', 'partial'] as const;
export const genders = ['male', 'female'] as const;
export const member_status = ['active', 'inactive', 'suspended'] as const;
const months = [
  '01',
  '02',
  '03',
  '04',
  '05',
  '06',
  '07',
  '08',
  '09',
  '10',
  '11',
  '12',
] as const;
export const payment_type = ['contribution', 'account'] as const;
export const member_balance_type = ['top_up', 'deduction'] as const;

// Enums
export const StatusEnum = z.enum(member_status);
export const RoleEnum = z.enum(member_roles);
export const GenderEnum = z.enum(genders);
export const ContributionStatusEnum = z.enum(contribution_status);
export const YearEnum = z.enum(years);
export const MonthEnum = z.enum(months);
export const PaymentTypeEnum = z.enum(payment_type);
export const MemberBalanceTypeEnum = z.enum(member_balance_type);

const FieldValueSchema = z.custom<FieldValue>(
  (value) => value instanceof FieldValue,
  { message: 'Invalid FieldValue' },
);

// Member Schema
export const ownMemberFormSchema = z.object({
  firstname: z.string().min(1, 'First name cannot be empty'),
  lastname: z.string().min(1, 'Last name cannot be empty'),
  membernumber: z
    .string()
    .min(1, 'Admission number cannot be empty')
    .regex(/^\d{5}\/\d{2}$/, 'Admission number format required is 00000/24'),
  win: z.string().min(1, 'Welfare Identification Number cannot be empty'),
  phonenumber: z
    .string()
    .min(1, 'Phone number cannot be empty')
    .refine(
      (value) => isMobilePhone(value, ['en-KE'], { strictMode: true }),
      'Provide a valid phone number',
    ),
  gender: GenderEnum,
});

export const memberFormSchema = ownMemberFormSchema.merge(
  z.object({
    email: z
      .string()
      .email('Invalid email address')
      .min(1, 'Email cannot be empty'),
    role: RoleEnum,
    isFeesPaid: z.boolean().default(false),
  }),
);

export const contributionFormSchema = z.object({
  year: YearEnum,
  month: MonthEnum,
});

export const memberBalanceFormSchema = z.object({
  type: MemberBalanceTypeEnum,
  amount: z
    .string()
    .transform((value) => parseFloat(value))
    .refine((value) => value > 0, { message: 'Amount must be greater than 0' }),
});

// Complete Member Schema (includes fields not in the form)
export const memberSchema = memberFormSchema.merge(
  z.object({
    member_id: z.string().min(1, 'ID cannot be empty'),
    status: StatusEnum,
    datejoined: z.date(),
    balance: z.number(),
    contributionBalance: z.number(),
  }),
);

export const firebaseTimestampSchema = z.object({
  seconds: z.number(),
  nanoseconds: z.number(),
});

export const paymentFormSchema = z.object({
  referencenumber: z
    .string()
    .min(1, 'Reference number cannot be empty')
    .regex(/^[a-zA-Z0-9]*$/, 'Reference number must be alphanumeric'),
  amount: z
    .string()
    .transform((value) => parseFloat(value))
    .refine((value) => value > 0, { message: 'Amount must be greater than 0' }),
  paymentdate: z.union([z.date(), firebaseTimestampSchema, FieldValueSchema]),
});

export const paymentSchema = paymentFormSchema.merge(
  z.object({
    payment_id: z.string(),
    firstname: z.string(),
    lastname: z.string(),
    contribution_id: z.string(),
    member_id: z.string().min(1, 'Member cannot be empty'),
    contribution_amount: z.number(),
    payment_type: PaymentTypeEnum,
    action_by: z.string(),
    created_at: z.union([FieldValueSchema, firebaseTimestampSchema]),
  }),
);

export const memberContributionSchema = z.object({
  contribution_id: z.string().min(1, 'Please select a member'),
  paid: ContributionStatusEnum,
  amount: z.number(),
  payments: z.array(paymentSchema),
  month: z.string(),
});

// Contribution Schema
export const contributionSchema = memberSchema.merge(memberContributionSchema);

export const monthlyStatsSchema = z.object({
  amount: z.number(),
  contribution: z.number(),
  paymentsCount: z.number(),
  month: z.string(),
  newMembers: z.number(),
  totalMembers: z.number(),
});

// TypeScript types from schemas
export type Member = z.infer<typeof memberSchema>;
export type MemberForm = z.infer<typeof memberFormSchema>;
export type OwnMemberForm = z.infer<typeof ownMemberFormSchema>;
export type ContributioForm = z.infer<typeof contributionFormSchema>;
export type Payment = z.infer<typeof paymentSchema>;
export type PaymentForm = z.infer<typeof paymentFormSchema>;
export type MemberContribution = z.infer<typeof memberContributionSchema>;
export type Contribution = z.infer<typeof contributionSchema>;
export type Gender = z.infer<typeof GenderEnum>;
export type Status = z.infer<typeof StatusEnum>;
export type Role = z.infer<typeof RoleEnum>;
export type Year = z.infer<typeof YearEnum>;
export type Month = z.infer<typeof MonthEnum>;
export type MemberBalanceType = z.infer<typeof MemberBalanceTypeEnum>;
export type PaymentStatus = z.infer<typeof ContributionStatusEnum>;
export type MonthlyStats = z.infer<typeof monthlyStatsSchema>;
export type FirebaseTimestamp = z.infer<typeof firebaseTimestampSchema>;
export type MemberBalanceForm = z.infer<typeof memberBalanceFormSchema>;
