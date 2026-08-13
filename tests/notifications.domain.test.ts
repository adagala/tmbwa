import { describe, expect, it } from 'vitest';
import { nextAttemptDelayMs, renderNotification } from '../functions/src/notifications/domain';

describe('member notification domain', () => {
  it('confirms only a reconciled payment with its stable receipt', () => {
    expect(renderNotification({ type: 'payment.reconciled', amount: 1000, receiptNumber: 'TMBWA-ABC' })).toEqual({
      title: 'Payment received', body: 'We received your payment of KES 1,000. Receipt: TMBWA-ABC.',
    });
  });

  it('distinguishes reversals and reminders from confirmations', () => {
    expect(renderNotification({ type: 'payment.reversed', receiptNumber: 'TMBWA-ABC' }).title).toBe('Payment reversed');
    expect(renderNotification({ type: 'contribution.due', contributionId: '2026-08-01' }).title).toBe('Contribution reminder');
    expect(renderNotification({ type: 'contribution.arrears', contributionId: '2026-07-01' }).title).toBe('Contribution in arrears');
  });

  it('uses bounded exponential retry delays', () => {
    expect(nextAttemptDelayMs(1)).toBe(60_000);
    expect(nextAttemptDelayMs(3)).toBe(240_000);
    expect(nextAttemptDelayMs(20)).toBe(3_600_000);
  });
});
