import { describe, expect, it } from 'vitest';
import {
  MEMBER_ROLE,
  MEMBER_STATUS,
  contributionDocumentSchema,
  memberDocumentSchema,
  monthlyStatsSchema,
  notificationDeliveryDocumentSchema,
  parseDocument,
  paymentDocumentSchema,
  unallocatedPaymentAmount,
} from 'tmbwa-shared';
import {
  parseContributionDocument,
  parsePaymentDocument,
} from 'tmbwa-shared/firebase';

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
  it('derives legacy credit unless an explicit amount is stored', () => {
    expect(unallocatedPaymentAmount(1000, 400)).toBe(600);
    expect(unallocatedPaymentAmount(1000, 400, 100)).toBe(100);
  });
  it('accepts valid member, payment, and contribution records', () => {
    expect(memberDocumentSchema.parse(member).status).toBe('active');
    expect(paymentDocumentSchema.parse(payment).amount).toBe(500);
    expect(
      paymentDocumentSchema.parse({
        ...payment,
        amount: 1000,
        contribution_amount: 900,
        allocations: [
          { contribution_id: '2026-08-01', amount: 400 },
          { contribution_id: '2026-07-01', amount: 500 },
        ],
        unallocated_amount: 100,
      }).allocations,
    ).toHaveLength(2);
    expect(
      contributionDocumentSchema.parse({
        ...member,
        contribution_id: '2026-08-01',
        paid: 'paid',
        amount: 500,
        balance: 0,
        payments: [payment],
        month: '2026-08-01',
      }).payments,
    ).toHaveLength(1);
  });

  it('rejects records missing fields that application code accesses', () => {
    expect(() =>
      parseDocument(
        memberDocumentSchema,
        {
          ...member,
          firstname: undefined,
        },
        'members/member-1',
      ),
    ).toThrow(/members\/member-1/);
  });

  it('rejects invalid notification delivery counters', () => {
    expect(
      notificationDeliveryDocumentSchema.safeParse({
        eventId: 'event-1',
        memberId: 'member-1',
        channel: 'in_app',
        status: 'pending',
        attempts: -1,
      }).success,
    ).toBe(false);
  });

  it('normalizes legacy contribution and payment records on read', () => {
    const legacyPayment = {
      ...payment,
      payment_type: undefined,
      action_by: undefined,
      created_at: undefined,
    };
    const parsedPayment = parsePaymentDocument('payment-1', legacyPayment);
    const parsedContribution = parseContributionDocument('2026-08-01', {
      ...member,
      member_id: 'member-1',
      paid: 'paid',
      amount: 500,
      balance: 0,
      payments: [legacyPayment],
      month: '2026-08-01',
    });

    expect(parsedPayment.payment_type).toBe('contribution');
    expect(parsedPayment.action_by).toBe('');
    expect(parsedPayment.created_at).toEqual(legacyPayment.paymentdate);
    expect(parsedContribution.action_by).toBe('');
    expect(parsedContribution.payments[0].payment_type).toBe('contribution');
  });

  it('defaults missing monthly statistics counters', () => {
    expect(
      monthlyStatsSchema.parse({
        amount: 500,
        contribution: 250,
        paymentsCount: 1,
        month: '2026-08-01',
      }),
    ).toMatchObject({ newMembers: 0, totalMembers: 0 });
  });
});
