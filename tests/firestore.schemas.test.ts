import { describe, expect, it } from 'vitest';
import {
  MEMBER_ROLE,
  MEMBER_STATUS,
  contributionDocumentSchema,
  memberDocumentSchema,
  notificationDeliveryDocumentSchema,
  parseDocument,
  paymentDocumentSchema,
} from 'tmbwa-shared';

const member = {
  firstname: 'Amina',
  lastname: 'Adagala',
  membernumber: '00001/24',
  win: 'WIN-1',
  phonenumber: '+254700000000',
  gender: 'female',
  email: 'amina@example.com',
  role: MEMBER_ROLE.MEMBER,
  isFeesPaid: true,
  status: MEMBER_STATUS.ACTIVE,
  balance: 0,
  contributionBalance: 0,
};

const payment = {
  payment_id: 'payment-1',
  referencenumber: 'REF1',
  amount: 500,
  paymentdate: { seconds: 1, nanoseconds: 0 },
  member_id: 'member-1',
  contribution_id: '2026-08-01',
  firstname: 'Amina',
  lastname: 'Adagala',
  contribution_amount: 500,
  payment_type: 'contribution',
};

describe('Firestore document schemas', () => {
  it('accepts valid member, payment, and contribution records', () => {
    expect(memberDocumentSchema.parse(member).status).toBe('active');
    expect(paymentDocumentSchema.parse(payment).amount).toBe(500);
    expect(contributionDocumentSchema.parse({
      ...member,
      contribution_id: '2026-08-01',
      paid: 'paid',
      amount: 500,
      balance: 0,
      payments: [payment],
      month: '2026-08-01',
    }).payments).toHaveLength(1);
  });

  it('rejects records missing fields that application code accesses', () => {
    expect(() => parseDocument(memberDocumentSchema, {
      ...member,
      firstname: undefined,
    }, 'members/member-1')).toThrow(/members\/member-1/);
  });

  it('rejects invalid notification delivery counters', () => {
    expect(notificationDeliveryDocumentSchema.safeParse({
      eventId: 'event-1',
      memberId: 'member-1',
      channel: 'in_app',
      status: 'pending',
      attempts: -1,
    }).success).toBe(false);
  });
});
