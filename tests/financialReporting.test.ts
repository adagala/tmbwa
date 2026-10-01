import { describe, expect, it } from 'vitest';
import type { Payment } from 'tmbwa-shared/firebase';
import {
  filterPayments,
  type ReportFilters,
} from '../src/lib/financialReporting';
import { paymentTypeLabel, statementRows } from '../src/lib/memberDocuments';

const filters: ReportFilters = {
  from: '',
  to: '',
  memberId: '',
  status: '',
  paymentType: '',
};

const payment = (
  paymentId: string,
  paymentType: Payment['payment_type'],
  paymentdate: Date,
): Payment =>
  ({
    payment_id: paymentId,
    payment_type: paymentType,
    paymentdate,
    member_id: 'member-1',
  }) as Payment;

describe('financial report filters', () => {
  it('filters contribution and account payments independently', () => {
    const payments = [
      payment('contribution-1', 'contribution', new Date(2026, 7, 15)),
      payment('account-1', 'account', new Date(2026, 7, 20)),
    ];

    expect(
      filterPayments(payments, { ...filters, paymentType: 'contribution' }).map(
        (item) => item.payment_id,
      ),
    ).toEqual(['contribution-1']);
    expect(
      filterPayments(payments, { ...filters, paymentType: 'account' }).map(
        (item) => item.payment_id,
      ),
    ).toEqual(['account-1']);
  });

  it('combines inclusive month and payment type filters', () => {
    const payments = [
      payment('july-account', 'account', new Date(2026, 6, 31)),
      payment('august-account', 'account', new Date(2026, 7, 10)),
      payment('august-contribution', 'contribution', new Date(2026, 7, 10)),
      payment('september-account', 'account', new Date(2026, 8, 1)),
    ];

    expect(
      filterPayments(payments, {
        ...filters,
        from: '2026-08',
        to: '2026-08',
        paymentType: 'account',
      }).map((item) => item.payment_id),
    ).toEqual(['august-account']);
  });
});

describe('member statement rows', () => {
  const payment = (overrides: Partial<Payment>) =>
    ({
      payment_id: 'payment-1',
      referencenumber: 'R-1',
      amount: 1500,
      paymentdate: new Date('2026-09-30T08:00:00Z'),
      member_id: 'member-a',
      contribution_id: '',
      firstname: 'Alice',
      lastname: 'Member',
      contribution_amount: 0,
      payment_type: 'account',
      ...overrides,
    }) as Payment;

  it('counts a top-up once and shows credit applied later without new money', () => {
    const rows = statementRows(
      [],
      [
        payment({ payment_purpose: 'account_top_up' }),
        payment({
          payment_id: 'payment-2',
          referencenumber: 'BALANCE B/F',
          amount: 500,
          contribution_id: '2026-10',
          contribution_amount: 500,
          payment_type: 'contribution',
          paymentdate: new Date('2026-10-01T00:00:00Z'),
        }),
      ],
    );
    expect(rows.map(({ description, charge, payment }) => ({ description, charge, payment })))
      .toEqual([
        { description: 'Account top-up – R-1', charge: 0, payment: 1500 },
        { description: 'Account credit applied – 2026-10', charge: 0, payment: 0 },
      ]);
    expect(paymentTypeLabel(payment({ payment_purpose: 'account_top_up' }))).toBe('top-up');
    expect(paymentTypeLabel(payment({ payment_type: 'contribution' }))).toBe('contribution');
  });
});
