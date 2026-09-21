import { describe, expect, it } from 'vitest';
import type { Payment } from 'tmbwa-shared/firebase';
import {
  filterPayments,
  type ReportFilters,
} from '../src/lib/financialReporting';

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
