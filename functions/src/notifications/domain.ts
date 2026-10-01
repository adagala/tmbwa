export type NotificationEvent = {
  type:
    | 'payment.reconciled'
    | 'payment.reversed'
    | 'contribution.created'
    | 'contributions.created'
    | 'contribution.due'
    | 'contribution.arrears'
    | 'beneficiary.change_approved'
    | 'beneficiary.change_rejected';
  receiptNumber?: string;
  amount?: number;
  contributionId?: string;
  contributionIds?: string[];
  balance?: number;
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
    case 'contributions.created': {
      const months = event.contributionIds ?? [];
      const range = months.length > 1 ? `${months[0]} to ${months[months.length - 1]}` : months[0] ?? 'past';
      return {
        title: 'Contributions added',
        body: `${months.length} contributions (${range}) were added to your account. ${money(event.balance)} is now due.`,
      };
    }
    case 'contribution.due':
      return { title: 'Contribution reminder', body: `Your ${event.contributionId ?? 'monthly'} contribution is still due.` };
    case 'contribution.arrears':
      return {
        title: 'Contribution in arrears',
        body: `Your ${event.contributionId ?? 'monthly'} contribution has an outstanding balance.`,
      };
    // Beneficiary details and the administrator's note stay in the app,
    // not in notification text.
    case 'beneficiary.change_approved':
      return {
        title: 'Beneficiary change approved',
        body: 'Your beneficiary change request was approved. Your beneficiaries are now updated.',
      };
    case 'beneficiary.change_rejected':
      return {
        title: 'Beneficiary change not approved',
        body: 'Your beneficiary change request was not approved. See your beneficiaries for the administrator\'s note.',
      };
    default:
      throw new Error('Unsupported notification event.');
  }
};

export const nextAttemptDelayMs = (attempts: number) => Math.min(60 * 60 * 1000, 60 * 1000 * 2 ** Math.max(0, attempts - 1));
