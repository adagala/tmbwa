import React from 'react';
import { Button } from '@/components/Button';
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/Drawer';
import { Contribution, Member } from 'tmbwa-shared/firebase';
import { ContributionStatusEnum } from 'tmbwa-shared';
import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/Badge';
import { Input } from '@/components/Input';
import { Label } from '@/components/Label';
import { RiSafe2Line, RiShoppingBag3Line } from '@remixicon/react';
import { DialogDeleteContributionPayment } from './DialogDeleteContributionPayment';
import { DialogLegacyContributionCorrection } from './DialogLegacyContributionCorrection';
import useUser from '@/hooks/useUser';
import { DialogDeleteContribution } from './DialogDeleteContribution';
import { DialogReverseLegacyCorrection } from './DialogReverseLegacyCorrection';
import { requestKcbStkPush } from '@/lib/firebase/kcb';
import { isKenyanMobileNumber } from '@/lib/kenyanPhone';
import { useToast } from '@/hooks/useToast';
import {
  formatNairobiDate,
  monthLabel,
  timestampDate,
} from '@/lib/financialReporting';
import { cx } from '@/lib/utils';

type Payment = Contribution['payments'][number];
type LegacyCorrection = Contribution['legacy_corrections'][number];

type HistoryEvent =
  | { kind: 'payment'; key: string; date: Date | null; payment: Payment }
  | {
      kind: 'correction';
      key: string;
      date: Date | null;
      correction: LegacyCorrection;
    };

// Oldest first; undated entries (pending payments) keep their order at the end.
const buildHistory = (contribution: Contribution): HistoryEvent[] =>
  [
    ...contribution.payments.map(
      (payment): HistoryEvent => ({
        kind: 'payment',
        key: `payment-${payment.payment_id}`,
        date: timestampDate(payment.paymentdate),
        payment,
      }),
    ),
    ...contribution.legacy_corrections.map(
      (correction, index): HistoryEvent => ({
        kind: 'correction',
        key: `${correction.correctionId}-${correction.type}-${index}`,
        date: timestampDate(correction.createdAt as Payment['paymentdate']),
        correction,
      }),
    ),
  ].sort((a, b) => {
    if (!a.date || !b.date) return a.date ? -1 : b.date ? 1 : 0;
    return a.date.getTime() - b.date.getTime();
  });

const formatDelta = (delta: number) =>
  `${delta > 0 ? '+' : delta < 0 ? '−' : ''}KES ${Math.abs(delta)}`;

export const DialogContributionDetails = ({
  contribution,
  member,
  open,
  setOpen,
}: {
  open: boolean;
  contribution: Contribution;
  member?: Member;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
  const { user, can } = useUser();
  const { toast } = useToast();
  const [isRequestingStk, setIsRequestingStk] = React.useState(false);
  const [stkPhone, setStkPhone] = React.useState(member?.phonenumber ?? '');
  const isValidStkPhone = isKenyanMobileNumber(stkPhone);
  // No one manages their own contributions; the backend refuses it too.
  const isOwnContribution = user?.uid === contribution.member_id;
  const canManageContributions =
    can('contributions.manage') && !isOwnContribution;
  const canReversePayments = can('payments.reverse') && !isOwnContribution;
  const history = buildHistory(contribution);
  const reversedCorrectionIds = new Set(
    contribution.legacy_corrections
      .filter((correction) => correction.type === 'reversal')
      .map((correction) => correction.correctionId),
  );
  const firstname = contribution.firstname || member?.firstname || '';
  const lastname = contribution.lastname || member?.lastname || '';
  const contributorName = `${firstname} ${lastname}`.trim() || 'Member';
  const initials =
    `${firstname.charAt(0)}${lastname.charAt(0)}`.toUpperCase() ||
    contributorName.charAt(0);
  const hasBalanceDue = contribution.balance > 0;
  const canRequestStk =
    !!user &&
    (isOwnContribution || can('kcb.reconcile')) &&
    member?.status === 'active' &&
    hasBalanceDue &&
    contribution.paid !== ContributionStatusEnum.Enum.paid;

  // Start from the member's number each time the drawer opens.
  React.useEffect(() => {
    if (open) setStkPhone(member?.phonenumber ?? '');
  }, [open, member?.phonenumber]);

  const requestContributionPayment = async () => {
    if (!user || !canRequestStk || !isValidStkPhone) return;
    setIsRequestingStk(true);
    try {
      await requestKcbStkPush({
        memberId: contribution.member_id,
        contributionId: contribution.contribution_id,
        amount: Number(contribution.balance),
        phone: stkPhone,
      });
      toast({
        title: 'STK Push requested',
        description:
          'Complete the M-Pesa prompt on the phone to pay this contribution.',
      });
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : 'Could not request STK Push for this contribution.';
      toast({
        title: 'STK request failed',
        description: message,
        variant: 'error',
      });
    } finally {
      setIsRequestingStk(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerContent className="overflow-hidden">
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-1.5 text-lg">
            <RiShoppingBag3Line
              className="size-5 shrink-0"
              aria-hidden="true"
            />
            Contribution details
          </DrawerTitle>
          <div className="mt-2 flex items-center gap-2.5">
            <Avatar initial={initials} className="size-9" />
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-50">
                {contributorName}
              </p>
              <DrawerDescription className="flex items-center gap-1.5 text-xs">
                {monthLabel(contribution.month)}
                <span aria-hidden="true">·</span>
                <Badge
                  className="capitalize"
                  variant={
                    contribution.paid === ContributionStatusEnum.Enum.paid
                      ? 'success'
                      : contribution.paid ===
                          ContributionStatusEnum.Enum.partial
                        ? 'warning'
                        : 'error'
                  }
                >
                  {contribution.paid}
                </Badge>
              </DrawerDescription>
            </div>
          </div>
        </DrawerHeader>

        <DrawerBody className="-mx-4 min-h-0 overflow-y-auto px-4 sm:-mx-6 sm:px-6">
          <dl className="grid grid-cols-2 gap-2.5">
            <div className="rounded-md border border-gray-200 px-3 py-2.5 dark:border-gray-800">
              <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Amount
              </dt>
              <dd className="mt-0.5 text-lg font-semibold text-gray-900 dark:text-gray-50">
                KES {contribution.amount}
              </dd>
            </div>
            <div
              className={cx(
                'rounded-md border px-3 py-2.5',
                hasBalanceDue
                  ? 'border-red-200 bg-red-50 dark:border-red-400/20 dark:bg-red-400/10'
                  : 'border-gray-200 dark:border-gray-800',
              )}
            >
              <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Balance due
              </dt>
              <dd
                className={cx(
                  'mt-0.5 text-lg font-semibold',
                  hasBalanceDue
                    ? 'text-red-700 dark:text-red-400'
                    : 'text-gray-900 dark:text-gray-50',
                )}
              >
                KES {contribution.balance}
              </dd>
            </div>
          </dl>

          <div className="mb-2 mt-5 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">
              History
            </h3>
            {canManageContributions ? (
              <DialogLegacyContributionCorrection contribution={contribution} />
            ) : null}
          </div>

          {history.length > 0 ? (
            <ol className="ml-1.5 grid gap-3.5 border-l-2 border-gray-200 pl-4 dark:border-gray-800">
              {history.map((event) => {
                if (event.kind === 'payment') {
                  const { payment } = event;
                  return (
                    <li key={event.key} className="relative text-sm">
                      <span
                        aria-hidden="true"
                        className="absolute -left-[23px] top-1 size-3 rounded-full border-2 border-emerald-600 bg-white dark:bg-[#090E1A]"
                      />
                      <div className="flex justify-between gap-3 font-medium text-gray-900 dark:text-gray-50">
                        <span>Payment</span>
                        <span>KES {payment.contribution_amount}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
                        <span>
                          <span className="font-mono">
                            {payment.referencenumber}
                          </span>{' '}
                          ·{' '}
                          {event.date
                            ? formatNairobiDate(event.date)
                            : 'Pending'}
                        </span>
                        {canReversePayments ? (
                          <DialogDeleteContributionPayment
                            contribution={contribution}
                            payment={payment}
                          />
                        ) : null}
                      </div>
                    </li>
                  );
                }

                const { correction } = event;
                const isReversal = correction.type === 'reversal';
                const isReversed =
                  !isReversal &&
                  reversedCorrectionIds.has(correction.correctionId);
                return (
                  <li key={event.key} className="relative text-sm">
                    <span
                      aria-hidden="true"
                      className={cx(
                        'absolute -left-[23px] top-1 size-3 rounded-full border-2 bg-white dark:bg-[#090E1A]',
                        isReversal ? 'border-gray-400' : 'border-amber-600',
                      )}
                    />
                    <div
                      className={cx(
                        'flex justify-between gap-3 font-medium',
                        isReversal
                          ? 'text-gray-500 dark:text-gray-400'
                          : 'text-gray-900 dark:text-gray-50',
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        {isReversal
                          ? 'Correction reversed'
                          : 'Legacy correction'}
                        {isReversed ? (
                          <Badge variant="neutral">Reversed</Badge>
                        ) : null}
                      </span>
                      <span>{formatDelta(correction.delta)}</span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {correction.reason} ·{' '}
                      <span className="font-mono">
                        {correction.correctionId}
                      </span>
                      {event.date
                        ? ` · ${formatNairobiDate(event.date)}`
                        : null}
                    </p>
                    {canManageContributions &&
                    correction.type === 'correction' &&
                    !isReversed ? (
                      <DialogReverseLegacyCorrection
                        memberId={contribution.member_id}
                        correctionId={correction.correctionId}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="flex flex-col items-center gap-1.5 py-6 text-gray-500 dark:text-gray-400">
              <RiSafe2Line className="size-6" aria-hidden="true" />
              <p className="text-sm">No payments made.</p>
            </div>
          )}
        </DrawerBody>

        <div className="-mx-4 -mb-4 border-t border-gray-200 bg-gray-50 px-4 pb-4 pt-4 dark:border-gray-900 dark:bg-gray-950 sm:-mx-6 sm:-mb-6 sm:px-6 sm:pb-6">
          {canRequestStk ? (
            <div className="mb-3">
              <Label htmlFor="contribution-stk-phone">
                M-Pesa phone number
              </Label>
              <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
                <Input
                  id="contribution-stk-phone"
                  className="sm:flex-1"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="e.g. 0712345678"
                  value={stkPhone}
                  onChange={(event) => setStkPhone(event.target.value)}
                  hasError={!isValidStkPhone}
                />
                <Button
                  className="whitespace-nowrap"
                  onClick={requestContributionPayment}
                  disabled={!isValidStkPhone}
                  isLoading={isRequestingStk}
                  loadingText="Requesting STK..."
                >
                  Pay KES {contribution.balance}
                </Button>
              </div>
              {isValidStkPhone ? (
                <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                  The M-Pesa prompt is sent to this number. It can be any
                  number; the payment is credited to this contribution.
                </p>
              ) : (
                <p className="mt-1.5 text-xs text-red-600 dark:text-red-500">
                  Enter a valid Kenyan mobile number.
                </p>
              )}
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            {member && canManageContributions ? (
              <DialogDeleteContribution
                contribution={contribution}
                member={member}
              />
            ) : (
              <span />
            )}
            <DrawerClose asChild>
              <Button variant="secondary">Close</Button>
            </DrawerClose>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
};
