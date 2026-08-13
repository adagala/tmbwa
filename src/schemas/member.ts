// schemas/member.ts
import { z } from 'zod';
import { isMobilePhone } from 'validator';
import { FieldValue } from 'firebase/firestore';
import {
  member_roles,
  member_status,
  genders,
  contribution_status,
  payment_type,
  member_balance_type,
  months,
  StatusEnum,
  RoleEnum,
  GenderEnum,
  ContributionStatusEnum,
  PaymentTypeEnum,
  MemberBalanceTypeEnum,
  YearEnum,
  MonthEnum,
  firebaseTimestampSchema,
  contributionFormSchema,
  memberBalanceFormSchema,
  monthlyStatsSchema,
} from 'tmbwa-shared';

export {
  member_roles,
  member_status,
  genders,
  contribution_status,
  payment_type,
  member_balance_type,
  months,
  StatusEnum,
  RoleEnum,
  GenderEnum,
  ContributionStatusEnum,
  PaymentTypeEnum,
  MemberBalanceTypeEnum,
  YearEnum,
  MonthEnum,
  firebaseTimestampSchema,
  contributionFormSchema,
  memberBalanceFormSchema,
  monthlyStatsSchema,
};

export type {
  MemberStatus,
  MemberRole,
  Gender,
  PaymentStatus,
  PaymentType,
  MemberBalanceType,
  Year,
  Month,
  ContributionForm,
  MemberBalanceForm,
  MonthlyStats,
  FirebaseTimestamp,
} from 'tmbwa-shared';

const FieldValueSchema = z.custom<FieldValue>(
  (value) => value instanceof FieldValue,
  { message: 'Invalid FieldValue' },
);

// Member form schema – extends the shared base with phone validation
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
    created_at: z.union([z.date(), FieldValueSchema, firebaseTimestampSchema]),
    receipt_number: z.string().optional(),
    balance_direction: MemberBalanceTypeEnum.optional(),
  }),
);

export const memberContributionSchema = z.object({
  contribution_id: z.string().min(1, 'Please select a member'),
  paid: ContributionStatusEnum,
  amount: z.number(),
  payments: z.array(paymentSchema),
  month: z.string(),
  action_by: z.string(),
});

// Contribution Schema
export const contributionSchema = memberSchema.merge(memberContributionSchema);

// TypeScript types from schemas
export type Member = z.infer<typeof memberSchema>;
export type MemberForm = z.infer<typeof memberFormSchema>;
export type OwnMemberForm = z.infer<typeof ownMemberFormSchema>;
export type Payment = z.infer<typeof paymentSchema>;
export type PaymentForm = z.infer<typeof paymentFormSchema>;
export type MemberContribution = z.infer<typeof memberContributionSchema>;
export type Contribution = z.infer<typeof contributionSchema>;
export type Role = z.infer<typeof RoleEnum>;
export type Status = z.infer<typeof StatusEnum>;

