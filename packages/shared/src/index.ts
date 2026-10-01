import { z } from 'zod';
import { isMobilePhone } from 'validator';

export * from './authorization';

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
export const MAX_CONTRIBUTION_MONTHS_PER_REQUEST = 60;

// ---------------------------------------------------------------------------
// Contribution months
// ---------------------------------------------------------------------------

const nairobiMonthFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Nairobi',
  year: 'numeric',
  month: '2-digit',
});

// Contribution ids are `YYYY-MM-01`, but legacy ids may be `YYYY-MM`, so
// months are compared by their `YYYY-MM` key.
export const contributionMonthKey = (month: string) => month.slice(0, 7);

export const nairobiContributionMonth = (date: Date) => {
  const parts = nairobiMonthFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!year || !month) {
    throw new Error('Unable to derive Nairobi month.');
  }
  return `${year}-${month}-01`;
};

// Every month from the member's join month through the current month that has
// no contribution, oldest first, as `YYYY-MM-01`.
export const missingContributionMonths = (
  joinedAt: Date | null | undefined,
  existingMonths: string[],
  currentMonth: string,
) => {
  if (!joinedAt || Number.isNaN(joinedAt.getTime())) return [];
  const existing = new Set(existingMonths.map(contributionMonthKey));
  const lastKey = contributionMonthKey(currentMonth);
  let [year, month] = contributionMonthKey(nairobiContributionMonth(joinedAt))
    .split('-')
    .map(Number);
  const missing: string[] = [];
  for (;;) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    if (key > lastKey) break;
    if (!existing.has(key)) missing.push(`${key}-01`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return missing;
};

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
export const STK_PURPOSE = {
  CONTRIBUTION: 'contribution',
  ACCOUNT_TOP_UP: 'account_top_up',
} as const;
export const stk_purpose = [
  STK_PURPOSE.CONTRIBUTION,
  STK_PURPOSE.ACCOUNT_TOP_UP,
] as const;
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
export const StkPurposeEnum = z.enum(stk_purpose);
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
    .regex(
      /^\d{3,8}\/\d{2}$/,
      'Admission number must have 3 to 8 digits, a forward slash, then 2 digits',
    ),
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
  payment_purpose: StkPurposeEnum.optional(),
}).passthrough();

export const legacyCorrectionSummarySchema = z.object({
  correctionId: z.string(),
  delta: z.number(),
  reason: z.string(),
  source: z.literal('legacy_correction'),
  actorId: z.string(),
  type: z.enum(['correction', 'reversal']).default('correction'),
  createdAt: z.unknown().optional(),
  reversed: z.boolean().optional(),
}).passthrough();

const contributionFinancialShape = {
  contribution_id: z.string(),
  paid: ContributionStatusEnum,
  amount: z.number(),
  balance: z.number(),
  payments: z.array(paymentDocumentSchema).default([]),
  legacy_corrections: z.array(legacyCorrectionSummarySchema).default([]),
  active_legacy_correction_id: z.string().optional(),
  month: z.string(),
  action_by: z.string().optional(),
  createdat: z.unknown().optional(),
};

// Used for new contribution writes: the member copy must satisfy current member rules.
export const contributionDocumentSchema = memberDocumentSchema
  .extend(contributionFinancialShape)
  .passthrough();

const memberSnapshotText = z
  .string()
  .nullish()
  .transform((value) => value ?? '');

// Used for contribution reads. Member fields on a contribution are a copy taken
// when it was created; members/{id} is the source of truth. Legacy copies may
// predate current member rules, so only the financial fields are validated strictly.
export const contributionReadDocumentSchema = z
  .object({
    ...contributionFinancialShape,
    member_id: z.string().optional(),
    firstname: memberSnapshotText,
    lastname: memberSnapshotText,
    membernumber: memberSnapshotText,
    win: memberSnapshotText,
    phonenumber: memberSnapshotText,
    email: memberSnapshotText,
  })
  .passthrough();

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
  contributionId: z.string().optional(),
  stkRequestId: z.string().optional(),
  requestedAmount: z.number().positive().optional(),
  paymentId: z.string().optional(),
  receiptNumber: z.string().optional(),
  allocations: z.array(z.object({
    contributionId: z.string().min(1),
    amount: z.number().positive(),
  })).default([]),
  unallocatedAmount: z.number().nonnegative().optional(),
  creditReserved: z.boolean().optional(),
  purpose: StkPurposeEnum.optional(),
}).passthrough();

export const kcbStkRequestStatusSchema = z.enum([
  'initiating',
  'dispatching',
  'outcome_unknown',
  'pending',
  'succeeded_pending_reconciliation',
  'reconciled',
  'failed',
  'cancelled',
  'timed_out',
  'rejected',
]);

export const kcbStkRequestDocumentSchema = z.object({
  requestId: z.string(),
  memberId: z.string(),
  contributionId: z.string(),
  purpose: StkPurposeEnum.optional(),
  amount: z.number().positive(),
  phone: z.string(),
  invoiceNumber: z.string(),
  messageId: z.string(),
  status: kcbStkRequestStatusSchema,
  merchantRequestId: z.string().nullable().optional(),
  checkoutRequestId: z.string().nullable().optional(),
  providerTransactionId: z.string().optional(),
  resultCode: z.number().int().optional(),
  resultDescription: z.string().optional(),
  failureCategory: z.string().optional(),
  callbackFailureReason: z.string().optional(),
  requestedBy: z.string().optional(),
  createdAt: z.unknown().optional(),
  updatedAt: z.unknown().optional(),
  callbackReceivedAt: z.unknown().optional(),
  leaseExpiresAt: z.unknown().optional(),
  dispatchStartedAt: z.unknown().optional(),
  dispatchExpiresAt: z.unknown().optional(),
  retryCount: z.number().int().nonnegative().optional(),
}).passthrough();

export const notificationEventDocumentSchema = z.object({
  type: z.enum([
    'payment.reconciled',
    'payment.reversed',
    'contribution.created',
    'contributions.created',
    'contribution.due',
    'contribution.arrears',
    'beneficiary.change_approved',
    'beneficiary.change_rejected',
  ]),
  memberId: z.string(),
  receiptNumber: z.string().optional(),
  amount: z.number().optional(),
  contributionId: z.string().optional(),
  contributionIds: z.array(z.string()).optional(),
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
  // Roles the actor held when the action was performed. Absent on system
  // events and on events written before role-based permissions.
  actorRoles: z.array(z.string()).optional(),
  action: z.string(),
  memberId: z.string(),
  targetId: z.string(),
  changes: z.record(z.unknown()),
  createdAt: z.unknown().optional(),
}).passthrough();

// ---------------------------------------------------------------------------
// Beneficiaries
// ---------------------------------------------------------------------------

export const MAX_BENEFICIARIES = 3;

export const beneficiary_relationships = [
  'spouse',
  'son',
  'daughter',
  'father',
  'mother',
  'brother',
  'sister',
  'grandfather',
  'grandmother',
  'grandson',
  'granddaughter',
  'nephew',
  'niece',
  'uncle',
  'aunt',
  'cousin',
  'father_in_law',
  'mother_in_law',
  'brother_in_law',
  'sister_in_law',
  'guardian',
  'dependant',
  'other',
] as const;

export const BENEFICIARY_RELATIONSHIP_LABELS: Record<
  (typeof beneficiary_relationships)[number],
  string
> = {
  spouse: 'Spouse',
  son: 'Son',
  daughter: 'Daughter',
  father: 'Father',
  mother: 'Mother',
  brother: 'Brother',
  sister: 'Sister',
  grandfather: 'Grandfather',
  grandmother: 'Grandmother',
  grandson: 'Grandson',
  granddaughter: 'Granddaughter',
  nephew: 'Nephew',
  niece: 'Niece',
  uncle: 'Uncle',
  aunt: 'Aunt',
  cousin: 'Cousin',
  father_in_law: 'Father-in-law',
  mother_in_law: 'Mother-in-law',
  brother_in_law: 'Brother-in-law',
  sister_in_law: 'Sister-in-law',
  guardian: 'Guardian',
  dependant: 'Dependant',
  other: 'Other',
};

// Reasons that allow a change beyond the one-per-calendar-year allowance.
export const beneficiary_change_reasons = [
  'beneficiary_deceased',
  'marriage',
  'divorce_or_separation',
  'birth_or_adoption',
  'error_correction',
  'other',
] as const;

export const BENEFICIARY_CHANGE_REASON_LABELS: Record<
  (typeof beneficiary_change_reasons)[number],
  string
> = {
  beneficiary_deceased: 'Death of a beneficiary',
  marriage: 'Marriage',
  divorce_or_separation: 'Divorce or separation',
  birth_or_adoption: 'Birth or adoption',
  error_correction: 'Correcting an error',
  other: 'Other',
};

export const beneficiary_change_request_types = [
  'initial',
  'annual',
  'exceptional',
] as const;
export const beneficiary_change_request_statuses = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
] as const;

export const BeneficiaryRelationshipEnum = z.enum(beneficiary_relationships);
export const BeneficiaryChangeReasonEnum = z.enum(beneficiary_change_reasons);
export const BeneficiaryChangeRequestTypeEnum = z.enum(
  beneficiary_change_request_types,
);
export const BeneficiaryChangeRequestStatusEnum = z.enum(
  beneficiary_change_request_statuses,
);

const nairobiDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Nairobi',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// `YYYY-MM-DD` for the given instant in Nairobi.
export const nairobiDateKey = (date: Date) => nairobiDateFormatter.format(date);

const isCalendarDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

// Firestore rejects `undefined` values, so absent optional fields are dropped.
const withoutUndefined = <Value extends Record<string, unknown>>(value: Value) =>
  Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Value;

// Form inputs submit '' for untouched optional fields; store them as absent.
const optionalText = <Schema extends z.ZodTypeAny>(schema: Schema) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }, schema.optional());

const personName = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} cannot be empty`)
    .max(100, `${label} must be at most 100 characters`);

export const beneficiarySchema = z
  .object({
    firstname: personName('First name'),
    lastname: personName('Last name'),
    relationship: BeneficiaryRelationshipEnum,
    relationshipOther: optionalText(
      z.string().max(60, 'Relationship must be at most 60 characters'),
    ),
    // Calendar date, not an instant, so it never shifts across time zones.
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Provide a valid date of birth')
      .refine(isCalendarDate, 'Provide a valid date of birth')
      .refine(
        (value) => value >= '1900-01-01',
        'Provide a valid date of birth',
      )
      .refine(
        (value) => value <= nairobiDateKey(new Date()),
        'Date of birth cannot be in the future',
      ),
    email: optionalText(z.string().email('Invalid email address')),
    phonenumber: optionalText(
      z
        .string()
        .refine(
          (value) => isMobilePhone(value, ['en-KE'], { strictMode: true }),
          'Provide a valid phone number',
        ),
    ),
    // Free text: national ID, passport or birth certificate number in any
    // format. The length cap only bounds storage, like the name fields.
    idnumber: optionalText(
      z.string().max(100, 'ID number must be at most 100 characters'),
    ),
  })
  .superRefine((beneficiary, context) => {
    if (beneficiary.relationship === 'other' && !beneficiary.relationshipOther) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['relationshipOther'],
        message: 'Describe the relationship',
      });
    }
  })
  .transform(
    ({ relationshipOther, ...beneficiary }): typeof beneficiary & {
      relationshipOther?: string;
    } =>
      withoutUndefined(
        beneficiary.relationship === 'other'
          ? { ...beneficiary, relationshipOther }
          : beneficiary,
      ),
  );

export const beneficiaryListSchema = z
  .array(beneficiarySchema)
  .min(1, 'Add at least one beneficiary')
  .max(
    MAX_BENEFICIARIES,
    `A member can have at most ${MAX_BENEFICIARIES} beneficiaries`,
  )
  .superRefine((beneficiaries, context) => {
    const seen = new Set<string>();
    beneficiaries.forEach((beneficiary, index) => {
      if (!beneficiary.idnumber) return;
      const key = beneficiary.idnumber.replace(/\s/g, '').toUpperCase();
      if (seen.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'idnumber'],
          message: 'Each beneficiary must have a different ID number',
        });
      }
      seen.add(key);
    });
  });

export const beneficiaryChangeReasonSchema = z
  .object({
    category: BeneficiaryChangeReasonEnum,
    text: optionalText(
      z.string().max(500, 'Reason must be at most 500 characters'),
    ),
  })
  .superRefine((reason, context) => {
    if (reason.category === 'other' && !reason.text) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['text'],
        message: 'Explain the reason for this change',
      });
    }
  })
  .transform(withoutUndefined);

// members/{memberId}/beneficiaries/{beneficiaryId}: approved beneficiaries.
// Written only by trusted Cloud Functions.
export const beneficiaryDocumentSchema = z
  .object({
    firstname: z.string().min(1),
    lastname: z.string().min(1),
    relationship: BeneficiaryRelationshipEnum,
    relationshipOther: z.string().optional(),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    email: z.string().optional(),
    phonenumber: z.string().optional(),
    idnumber: z.string().optional(),
    // Change request that produced this record.
    requestId: z.string(),
    approvedBy: z.string(),
    approvedAt: z.unknown().optional(),
  })
  .passthrough();

// members/{memberId}/beneficiary_state/current: server-owned bookkeeping kept
// off the member document, which is copied into contribution records.
export const beneficiaryStateDocumentSchema = z
  .object({
    // Incremented on every approved change; requests record the version they
    // were made against so stale requests cannot be approved.
    version: z.number().int().nonnegative(),
    // Nairobi calendar year whose annual change has been used.
    lastAnnualChangeYear: z.number().int().nullable().default(null),
    pendingRequestId: z.string().nullable().default(null),
    updatedAt: z.unknown().optional(),
  })
  .passthrough();

// beneficiary_change_requests/{requestId}. Never deleted: these are the
// history of every beneficiary change.
export const beneficiaryChangeRequestDocumentSchema = z
  .object({
    memberId: z.string().min(1),
    type: BeneficiaryChangeRequestTypeEnum,
    reason: beneficiaryChangeReasonSchema.optional(),
    proposedBeneficiaries: beneficiaryListSchema,
    baseVersion: z.number().int().nonnegative(),
    status: BeneficiaryChangeRequestStatusEnum,
    submittedBy: z.string().min(1),
    // Command that created the request; retries must come from the same one.
    origin: z.enum(['member', 'administrator']),
    submittedAt: z.unknown().optional(),
    reviewedBy: z.string().optional(),
    reviewedAt: z.unknown().optional(),
    reviewNote: z.string().optional(),
    cancelledAt: z.unknown().optional(),
  })
  .passthrough()
  .superRefine((request, context) => {
    if (request.type === 'exceptional' && !request.reason) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'An exceptional change requires a reason',
      });
    }
  });

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
export type StkPurpose = z.infer<typeof StkPurposeEnum>;
export type MemberBalanceType = z.infer<typeof MemberBalanceTypeEnum>;
export type Year = z.infer<typeof YearEnum>;
export type Month = z.infer<typeof MonthEnum>;

export type MemberBase = z.infer<typeof memberBaseSchema>;
export type MemberFormBase = z.infer<typeof memberFormBaseSchema>;
export type ContributionForm = z.infer<typeof contributionFormSchema>;
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
export type BeneficiaryRelationship = z.infer<typeof BeneficiaryRelationshipEnum>;
export type BeneficiaryChangeReasonCategory = z.infer<typeof BeneficiaryChangeReasonEnum>;
export type BeneficiaryChangeRequestType = z.infer<typeof BeneficiaryChangeRequestTypeEnum>;
export type BeneficiaryChangeRequestStatus = z.infer<typeof BeneficiaryChangeRequestStatusEnum>;
export type BeneficiaryInput = z.input<typeof beneficiarySchema>;
export type Beneficiary = z.infer<typeof beneficiarySchema>;
export type BeneficiaryChangeReason = z.infer<typeof beneficiaryChangeReasonSchema>;
export type BeneficiaryDocument = z.infer<typeof beneficiaryDocumentSchema>;
export type BeneficiaryState = z.infer<typeof beneficiaryStateDocumentSchema>;
export type BeneficiaryChangeRequest = z.infer<typeof beneficiaryChangeRequestDocumentSchema>;
