import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const member_roles = ['member', 'administrator'] as const;
export const member_status = [
  'active',
  'inactive',
  'suspended',
  'resigned',
  'deceased',
] as const;
export const genders = ['male', 'female'] as const;
export const contribution_status = ['paid', 'unpaid', 'partial'] as const;
export const payment_type = ['contribution', 'account'] as const;
export const member_balance_type = ['top_up', 'deduction'] as const;
export const months = [
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

// ---------------------------------------------------------------------------
// Zod enums derived from constants
// ---------------------------------------------------------------------------

export const StatusEnum = z.enum(member_status);
export const RoleEnum = z.enum(member_roles);
export const GenderEnum = z.enum(genders);
export const ContributionStatusEnum = z.enum(contribution_status);
export const PaymentTypeEnum = z.enum(payment_type);
export const MemberBalanceTypeEnum = z.enum(member_balance_type);
export const YearEnum = z.string().regex(/^\d{4}$/, 'Provide a valid year');
export const MonthEnum = z.enum(months);

// ---------------------------------------------------------------------------
// Platform-agnostic base schemas
// (No FieldValue / Timestamp – those are platform-specific)
// ---------------------------------------------------------------------------

export const memberBaseSchema = z.object({
  firstname: z.string().min(1, 'First name cannot be empty'),
  lastname: z.string().min(1, 'Last name cannot be empty'),
  membernumber: z
    .string()
    .min(1, 'Admission number cannot be empty')
    .regex(/^\d{5}\/\d{2}$/, 'Admission number format required is 00000/24'),
  win: z.string().min(1, 'Welfare Identification Number cannot be empty'),
  phonenumber: z.string().min(1, 'Phone number cannot be empty'),
  gender: GenderEnum,
});

export const memberFormBaseSchema = memberBaseSchema.merge(
  z.object({
    email: z
      .string()
      .email('Invalid email address')
      .min(1, 'Email cannot be empty'),
    role: RoleEnum,
    isFeesPaid: z.boolean().default(false),
  }),
);

export const firebaseTimestampSchema = z.object({
  seconds: z.number(),
  nanoseconds: z.number(),
});

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

export const monthlyStatsSchema = z.object({
  amount: z.number(),
  contribution: z.number(),
  paymentsCount: z.number(),
  month: z.string(),
  newMembers: z.number(),
  totalMembers: z.number(),
});

// ---------------------------------------------------------------------------
// TypeScript types
// ---------------------------------------------------------------------------

export type MemberRole = z.infer<typeof RoleEnum>;
export type MemberStatus = z.infer<typeof StatusEnum>;
export type Gender = z.infer<typeof GenderEnum>;
export type PaymentStatus = z.infer<typeof ContributionStatusEnum>;
export type PaymentType = z.infer<typeof PaymentTypeEnum>;
export type MemberBalanceType = z.infer<typeof MemberBalanceTypeEnum>;
export type Year = z.infer<typeof YearEnum>;
export type Month = z.infer<typeof MonthEnum>;

export type MemberBase = z.infer<typeof memberBaseSchema>;
export type MemberFormBase = z.infer<typeof memberFormBaseSchema>;
export type ContributionForm = z.infer<typeof contributionFormSchema>;
export type MemberBalanceForm = z.infer<typeof memberBalanceFormSchema>;
export type MonthlyStats = z.infer<typeof monthlyStatsSchema>;
export type FirebaseTimestamp = z.infer<typeof firebaseTimestampSchema>;
