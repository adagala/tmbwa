export type NotificationEvent = {
  type: 'payment.reconciled' | 'payment.reversed' | 'contribution.created' | 'contribution.due' | 'contribution.arrears';
  receiptNumber?: string;
  amount?: number;
  contributionId?: string;
};

export type NotificationMessage = { title: string; body: string };

const money = (amount: number | undefined) => `KES ${Number(amount ?? 0).toLocaleString('en-KE')}`;

export const renderNotification = (event: NotificationEvent): NotificationMessage => {
  switch (event.type) {
    case 'payment.reconciled':
      return {
        title: 'Payment received',
        body: `We received your payment of ${money(event.amount)}. Receipt: ${event.receiptNumber ?? 'pending'}.`,
      };
    case 'payment.reversed':
      return {
        title: 'Payment reversed',
        body: `Payment ${event.receiptNumber ?? ''} was reversed. Review your statement or contact an administrator.`,
      };
    case 'contribution.created':
      return { title: 'Monthly contribution', body: `Your ${event.contributionId ?? 'monthly'} contribution is now due.` };
    case 'contribution.due':
      return { title: 'Contribution reminder', body: `Your ${event.contributionId ?? 'monthly'} contribution is still due.` };
    case 'contribution.arrears':
      return {
        title: 'Contribution in arrears',
        body: `Your ${event.contributionId ?? 'monthly'} contribution has an outstanding balance.`,
      };
    default:
      throw new Error('Unsupported notification event.');
  }
};

export const nextAttemptDelayMs = (attempts: number) => Math.min(60 * 60 * 1000, 60 * 1000 * 2 ** Math.max(0, attempts - 1));
