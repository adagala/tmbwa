import React from 'react';
import { RiAddLine, RiSmartphoneLine } from '@remixicon/react';
import { Contribution, Member } from 'tmbwa-shared/firebase';
import { Button } from '@/components/Button';
import { Callout } from '@/components/Callout';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/Dialog';
import { Input } from '@/components/Input';
import { Label } from '@/components/Label';
import { useToast } from '@/hooks/useToast';
import { monthLabel } from '@/lib/financialReporting';
import {
  requestKcbAccountTopUp,
  subscribeToKcbStkRequestStatus,
} from '@/lib/firebase/kcb';
import { isKenyanMobileNumber } from '@/lib/kenyanPhone';

const formatKes = (value: number) =>
  `KES ${value.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;

// Mirrors the server's oldest-first settlement for display only; the backend
// recalculates when the payment arrives.
const previewTopUp = (amount: number, contributions: Contribution[]) => {
  let remaining = amount;
  const settled = [...contributions]
    .filter((item) => Number(item.balance) > 0)
    .sort(
      (a, b) =>
        a.month.localeCompare(b.month) ||
        a.contribution_id.localeCompare(b.contribution_id),
    )
    .flatMap((item) => {
      if (remaining <= 0) return [];
      const allocated = Math.min(remaining, Number(item.balance));
      remaining -= allocated;
      return [{ contribution: item, allocated }];
    });
  return { settled, credit: remaining };
};

const pendingStatuses = ['initiating', 'dispatching', 'pending'];

const statusMessage = (status: string | undefined) => {
  if (!status || pendingStatuses.includes(status)) {
    return {
      variant: 'default' as const,
      title: 'Waiting for M-Pesa',
      body: 'Approve the prompt on the phone to complete the top-up.',
    };
  }
  if (status === 'reconciled') {
    return {
      variant: 'success' as const,
      title: 'Top-up received',
      body: 'Your account has been credited.',
    };
  }
  if (status === 'succeeded_pending_reconciliation') {
    return {
      variant: 'default' as const,
      title: 'Payment received',
      body: 'An administrator will confirm it and credit your account shortly.',
    };
  }
  if (status === 'outcome_unknown') {
    return {
      variant: 'warning' as const,
      title: 'Payment not yet confirmed',
      body: 'An administrator will verify the payment before you try again.',
    };
  }
  return {
    variant: 'error' as const,
    title: 'Top-up not completed',
    body: 'If M-Pesa deducted money, contact an administrator. Otherwise you can try again.',
  };
};

export const DialogAccountTopUp = ({
  member,
  contributions,
}: {
  member: Member;
  contributions: Contribution[];
}) => {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [amountText, setAmountText] = React.useState('');
  const [phone, setPhone] = React.useState(member.phonenumber);
  const [isRequesting, setIsRequesting] = React.useState(false);
  const [requestId, setRequestId] = React.useState<string>();
  const [status, setStatus] = React.useState<string>();

  const amount = Number(amountText);
  const isValidAmount = Number.isInteger(amount) && amount > 0;
  const isValidPhone = isKenyanMobileNumber(phone);
  const preview = isValidAmount ? previewTopUp(amount, contributions) : null;

  React.useEffect(() => {
    if (!requestId) return;
    return subscribeToKcbStkRequestStatus(requestId, setStatus);
  }, [requestId]);

  const reset = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setAmountText('');
      setPhone(member.phonenumber);
      setRequestId(undefined);
      setStatus(undefined);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isValidAmount || !isValidPhone || isRequesting) return;
    setIsRequesting(true);
    try {
      const result = await requestKcbAccountTopUp({
        memberId: member.member_id,
        amount,
        phone,
      });
      setStatus(result.data.status);
      setRequestId(result.data.requestId);
    } catch (cause) {
      toast({
        title: 'Top-up request failed',
        description:
          cause instanceof Error
            ? cause.message
            : 'Could not request an M-Pesa prompt.',
        variant: 'error',
      });
    } finally {
      setIsRequesting(false);
    }
  };

  const message = requestId ? statusMessage(status) : null;

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant="secondary" className="gap-1.5">
          <RiAddLine className="size-4 shrink-0" aria-hidden="true" />
          Add funds
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1">
              <RiSmartphoneLine
                className="size-5 shrink-0"
                aria-hidden="true"
              />
              Add funds to account
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm leading-6">
              Pay any amount by M-Pesa. It first clears unpaid contributions,
              oldest first. Anything left stays on the account and pays future
              monthly contributions automatically.
            </DialogDescription>
          </DialogHeader>

          {message ? (
            <Callout
              className="mt-6"
              title={message.title}
              variant={message.variant}
            >
              {message.body}
            </Callout>
          ) : (
            <div className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="top-up-amount">Amount (KES)</Label>
                <Input
                  id="top-up-amount"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  placeholder="e.g. 1500"
                  value={amountText}
                  onChange={(event) => setAmountText(event.target.value)}
                  hasError={amountText !== '' && !isValidAmount}
                />
                {amountText !== '' && !isValidAmount ? (
                  <p className="text-xs text-red-600 dark:text-red-500">
                    Enter a whole number of shillings greater than zero.
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="top-up-phone">M-Pesa phone number</Label>
                <Input
                  id="top-up-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="e.g. 0712345678"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  hasError={!isValidPhone}
                />
                {isValidPhone ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    The M-Pesa prompt is sent to this number. It can be any
                    number; the payment is credited to this account.
                  </p>
                ) : (
                  <p className="text-xs text-red-600 dark:text-red-500">
                    Enter a valid Kenyan mobile number.
                  </p>
                )}
              </div>

              {preview ? (
                <div className="rounded-md border border-gray-200 p-3 text-sm dark:border-gray-800">
                  <div className="font-medium text-gray-900 dark:text-gray-50">
                    How {formatKes(amount)} will be used
                  </div>
                  <ul className="mt-2 space-y-1 text-gray-700 dark:text-gray-300">
                    {preview.settled.map(({ contribution, allocated }) => (
                      <li
                        key={contribution.contribution_id}
                        className="flex justify-between gap-4"
                      >
                        <span>
                          {monthLabel(contribution.month)} contribution
                        </span>
                        <span className="tabular-nums">
                          {formatKes(allocated)}
                        </span>
                      </li>
                    ))}
                    <li className="flex justify-between gap-4">
                      <span>Held for future contributions</span>
                      <span className="tabular-nums">
                        {formatKes(preview.credit)}
                      </span>
                    </li>
                  </ul>
                </div>
              ) : null}
            </div>
          )}

          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button
                className="mt-2 w-full sm:mt-0 sm:w-fit"
                variant="secondary"
              >
                Close
              </Button>
            </DialogClose>
            {!requestId ? (
              <Button
                className="w-full sm:w-fit"
                type="submit"
                disabled={!isValidAmount || !isValidPhone}
                isLoading={isRequesting}
                loadingText="Requesting prompt..."
              >
                Send M-Pesa prompt
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
