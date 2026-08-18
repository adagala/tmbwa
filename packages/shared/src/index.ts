import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MEMBER_ROLE = {
  MEMBER: 'member',
  ADMINISTRATOR: 'administrator',
} as const;
export const MEMBER_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  SUSPENDED: 'suspended',
  RESIGNED: 'resigned',
  DECEASED: 'deceased',
} as const;
export const GENDER = { MALE: 'male', FEMALE: 'female' } as const;
export const PAYMENT_STATUS = {
  PAID: 'paid',
  UNPAID: 'unpaid',
  PARTIAL: 'partial',
} as const;
export const MONTHLY_CONTRIBUTION = 500;

export const unallocatedPaymentAmount = (
  amount: number,
  contributionAmount: number,
  storedAmount?: number,
) =>
  storedAmount === undefined
    ? Math.max(Number(amount) - Number(contributionAmount), 0)
    : Number(storedAmount);

export const member_roles = [
  MEMBER_ROLE.MEMBER,
  MEMBER_ROLE.ADMINISTRATOR,
] as const;
export const member_status = [
  MEMBER_STATUS.ACTIVE,
  MEMBER_STATUS.INACTIVE,
  MEMBER_STATUS.SUSPENDED,
  MEMBER_STATUS.RESIGNED,
  MEMBER_STATUS.DECEASED,
] as const;
export const genders = [GENDER.MALE, GENDER.FEMALE] as const;
export const contribution_status = [
  PAYMENT_STATUS.PAID,
  PAYMENT_STATUS.UNPAID,
  PAYMENT_STATUS.PARTIAL,
] as const;
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
  newMembers: z.number().default(0),
  totalMembers: z.number().default(0),
});

const searchableIndexSchema = z.record(z.boolean());

export const memberDocumentSchema = memberFormBaseSchema.extend({
  status: StatusEnum,
  balance: z.number(),
  contributionBalance: z.number(),
  reservedKcbCredit: z.number().nonnegative().default(0),
  firstnameSearchableIndex: searchableIndexSchema.optional(),
  lastnameSearchableIndex: searchableIndexSchema.optional(),
  createat: z.unknown().optional(),
  datejoined: z.unknown().optional(),
}).passthrough();
export const memberWithIdDocumentSchema = memberDocumentSchema.extend({
  member_id: z.string(),
});

export const paymentDocumentSchema = z.object({
  payment_id: z.string(),
  referencenumber: z.string(),
  amount: z.number(),
  paymentdate: z.unknown(),
  member_id: z.string(),
  contribution_id: z.string(),
  firstname: z.string(),
  lastname: z.string(),
  contribution_amount: z.number(),
  payment_type: PaymentTypeEnum.optional(),
  action_by: z.string().optional(),
  created_at: z.unknown().optional(),
  receipt_number: z.string().optional(),
  balance_direction: MemberBalanceTypeEnum.optional(),
  allocations: z.array(z.object({
    contribution_id: z.string().min(1),
    amount: z.number().positive(),
  })).optional(),
  unallocated_amount: z.number().nonnegative().optional(),
  credit_reserved: z.boolean().optional(),
}).passthrough();

export const contributionDocumentSchema = memberDocumentSchema.extend({
  contribution_id: z.string(),
  paid: ContributionStatusEnum,
  amount: z.number(),
  balance: z.number(),
  payments: z.array(paymentDocumentSchema).default([]),
  month: z.string(),
  action_by: z.string().optional(),
  createdat: z.unknown().optional(),
}).passthrough();

export const contributionRateDocumentSchema = z.object({
  amount: z.number().positive(),
  effectiveFrom: z.string().optional(),
}).passthrough();

export const kcbPaymentNotificationDocumentSchema = z.object({
  payerPhone: z.string(),
  payerName: z.string(),
  amount: z.number().positive(),
  currency: z.string(),
  billReference: z.string(),
  transactionDate: z.string(),
  status: z.enum(['unresolved', 'reconciled', 'rejected', 'reversed']),
  suggestedMemberId: z.string().nullable().optional(),
  matchReason: z.string(),
  receivedAt: z.unknown().optional(),
  memberId: z.string().optional(),
  paymentId: z.string().optional(),
  receiptNumber: z.string().optional(),
  allocations: z.array(z.object({
    contributionId: z.string().min(1),
    amount: z.number().positive(),
  })).default([]),
  unallocatedAmount: z.number().nonnegative().optional(),
  creditReserved: z.boolean().optional(),
}).passthrough();

export const kcbStkRequestDocumentSchema = z.object({
  requestId: z.string(),
  memberId: z.string(),
  contributionId: z.string(),
  amount: z.number().positive(),
  phone: z.string(),
  invoiceNumber: z.string(),
  messageId: z.string(),
  status: z.string(),
  merchantRequestId: z.string().nullable().optional(),
  checkoutRequestId: z.string().nullable().optional(),
  callbackReceivedAt: z.unknown().optional(),
}).passthrough();

export const notificationEventDocumentSchema = z.object({
  type: z.enum([
    'payment.reconciled',
    'payment.reversed',
    'contribution.created',
    'contribution.due',
    'contribution.arrears',
  ]),
  memberId: z.string(),
  receiptNumber: z.string().optional(),
  amount: z.number().optional(),
  contributionId: z.string().optional(),
  balance: z.number().optional(),
  createdAt: z.unknown().optional(),
}).passthrough();

export const notificationPreferenceDocumentSchema = z.object({
  inAppEnabled: z.boolean(),
  updatedAt: z.unknown().optional(),
}).passthrough();

export const notificationDeliveryDocumentSchema = z.object({
  eventId: z.string(),
  memberId: z.string(),
  channel: z.string(),
  status: z.string(),
  attempts: z.number().int().nonnegative(),
  createdAt: z.unknown().optional(),
}).passthrough();

export const memberNotificationDocumentSchema = z.object({
  eventId: z.string().optional(),
  title: z.string(),
  body: z.string(),
  read: z.boolean(),
  createdAt: z.unknown().optional(),
}).passthrough();

export const auditEventDocumentSchema = z.object({
  requestId: z.string(),
  actorId: z.string(),
  action: z.string(),
  memberId: z.string(),
  targetId: z.string(),
  changes: z.record(z.unknown()),
  createdAt: z.unknown().optional(),
}).passthrough();

export const parseDocument = <Schema extends z.ZodTypeAny>(
  schema: Schema,
  value: unknown,
  path: string,
): z.infer<Schema> => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid Firestore document at ${path}: ${result.error.message}`);
  }
  return result.data;
};

export const userSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const passwordSchema = z
  .object({
    currentpassword: z.string().min(1, 'Current password is required'),
    password: z.string().min(6, 'Password must be at least 6 characters long'),
    confirmpassword: z.string().min(1, 'Confirm your password'),
  })
  .refine((data) => data.password === data.confirmpassword, {
    message: 'Passwords must match',
    path: ['confirmpassword'],
  });

export const resetPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
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
export type UserSchema = z.infer<typeof userSchema>;
export type PasswordSchema = z.infer<typeof passwordSchema>;
export type ResetPasswordSchema = z.infer<typeof resetPasswordSchema>;
export type KcbPaymentNotification = z.infer<typeof kcbPaymentNotificationDocumentSchema> & {
  providerTransactionId: string;
};
export type MemberNotification = z.infer<typeof memberNotificationDocumentSchema> & { id: string };
export type NotificationDelivery = z.infer<typeof notificationDeliveryDocumentSchema> & { id: string };
export type AuditEvent = z.infer<typeof auditEventDocumentSchema>;
