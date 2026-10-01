import { FieldValue, Timestamp } from 'firebase/firestore';
import { isMobilePhone } from 'validator';
import { z } from 'zod';

import {
  MemberBalanceTypeEnum,
  PaymentTypeEnum,
  StkPurposeEnum,
  StatusEnum,
  auditEventDocumentSchema,
  contributionReadDocumentSchema,
  firebaseTimestampSchema,
  kcbPaymentNotificationDocumentSchema,
  memberBaseSchema,
  memberFormBaseSchema,
  memberNotificationDocumentSchema,
  notificationDeliveryDocumentSchema,
  notificationPreferenceDocumentSchema,
  parseDocument,
  paymentDocumentSchema,
} from './index';

const fieldValueSchema = z.custom<FieldValue>(
  (value) => value instanceof FieldValue,
  { message: 'Invalid FieldValue' },
);

export const ownMemberFormSchema = memberBaseSchema.extend({
  phonenumber: z
    .string()
    .min(1, 'Phone number cannot be empty')
    .refine(
      (value) => isMobilePhone(value, ['en-KE'], { strictMode: true }),
      'Provide a valid phone number',
    ),
});

// Roles are not part of the form: they change only through assignMemberRoles.
export const memberFormSchema = ownMemberFormSchema
  .merge(memberFormBaseSchema.pick({ email: true, isFeesPaid: true }))
  .extend({
    // Administrator-only. Required on the form; stored documents may predate it.
    datejoined: z
      .date({
        required_error: 'Date joined is required',
        invalid_type_error: 'Date joined is required',
      })
      .refine((date) => date <= new Date(), 'Date joined cannot be in the future'),
  });

export const memberSchema = memberFormSchema.merge(
  z.object({
    member_id: z.string().min(1, 'ID cannot be empty'),
    // Server-owned; see assignMemberRoles.
    roles: z.array(z.string()).optional(),
    status: StatusEnum,
    datejoined: z.union([z.date(), z.instanceof(Timestamp)]).optional(),
    createat: z.instanceof(Timestamp).optional(),
    balance: z.number(),
    contributionBalance: z.number(),
    reservedKcbCredit: z.number().nonnegative().default(0),
  }),
);

const memberReadSchema = memberSchema.extend({
  status: StatusEnum.default('active'),
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
  paymentdate: z.union([z.date(), firebaseTimestampSchema, fieldValueSchema]),
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
    created_at: z.union([z.date(), fieldValueSchema, firebaseTimestampSchema]),
    receipt_number: z.string().optional(),
    balance_direction: MemberBalanceTypeEnum.optional(),
    allocations: z.array(z.object({
      contribution_id: z.string().min(1),
      amount: z.number().positive(),
    })).optional(),
    unallocated_amount: z.number().nonnegative().optional(),
    credit_reserved: z.boolean().optional(),
    payment_purpose: StkPurposeEnum.optional(),
  }),
);

const persistedDateSchema = z.union([
  z.date(),
  z.instanceof(Timestamp),
  firebaseTimestampSchema,
]);

const paymentReadSchema = paymentDocumentSchema.extend({
  paymentdate: persistedDateSchema,
  payment_type: PaymentTypeEnum.default(PaymentTypeEnum.Enum.contribution),
  action_by: z.string().default(''),
  created_at: persistedDateSchema.optional(),
}).transform((payment) => ({
  ...payment,
  created_at: payment.created_at ?? payment.paymentdate,
}));

// Member fields on a contribution are a historical copy; see contributionReadDocumentSchema.
const contributionReadSchema = contributionReadDocumentSchema.extend({
  member_id: z.string(),
  createdat: z.union([z.date(), z.instanceof(Timestamp)]).optional(),
  action_by: z.string().default(''),
  payments: z.array(paymentReadSchema).default([]),
});

export const kcbPaymentNotificationSchema = kcbPaymentNotificationDocumentSchema.extend({
  providerTransactionId: z.string(),
  receivedAt: z.instanceof(Timestamp).optional(),
});
export const memberNotificationSchema = memberNotificationDocumentSchema.extend({
  id: z.string(),
  createdAt: z.instanceof(Timestamp).optional(),
});
export const notificationDeliverySchema = notificationDeliveryDocumentSchema.extend({
  id: z.string(),
  createdAt: z.instanceof(Timestamp).optional(),
});
export const notificationPreferenceSchema = notificationPreferenceDocumentSchema.extend({
  updatedAt: z.union([z.instanceof(Timestamp), fieldValueSchema]).optional(),
});
export const auditEventSchema = auditEventDocumentSchema.extend({
  createdAt: z.instanceof(Timestamp).optional(),
});

export const parseMemberDocument = (id: string, data: unknown) =>
  parseDocument(
    memberReadSchema,
    { member_id: id, ...(data as object) },
    `members/${id}`,
  );

const normalizePaymentDocument = (id: string, data: unknown, path: string) => {
  return parseDocument(
    paymentReadSchema,
    { payment_id: id, ...(data as object) },
    path,
  );
};

export const parseContributionDocument = (id: string, data: unknown) => {
  const path = `contributions/${id}`;
  return parseDocument(
    contributionReadSchema,
    { contribution_id: id, ...(data as object) },
    path,
  );
};

export const parsePaymentDocument = (id: string, data: unknown) =>
  normalizePaymentDocument(id, data, `payments/${id}`);

export type Member = z.infer<typeof memberSchema>;
export type MemberForm = z.infer<typeof memberFormSchema>;
export type OwnMemberForm = z.infer<typeof ownMemberFormSchema>;
export type Payment = z.infer<typeof paymentSchema>;
export type PaymentForm = z.infer<typeof paymentFormSchema>;
export type Contribution = z.infer<typeof contributionReadSchema>;
export type KcbPaymentNotification = z.infer<typeof kcbPaymentNotificationSchema>;
export type MemberNotification = z.infer<typeof memberNotificationSchema>;
export type NotificationDelivery = z.infer<typeof notificationDeliverySchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
