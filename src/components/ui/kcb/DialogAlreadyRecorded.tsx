import React from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { Timestamp } from 'firebase/firestore';
import { Button } from '@/components/Button';
import { Callout } from '@/components/Callout';
import { Checkbox } from '@/components/Checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/Dialog';
import { Label } from '@/components/Label';
import { Textarea } from '@/components/Textarea';
import { db } from '@/lib/firebase/clientApp';
import {
  KcbPaymentNotification,
  markKcbPaymentAlreadyRecorded,
} from '@/lib/firebase/kcb';
import { formatEatDate } from '@/lib/kcbReconciliation';
import {
  RecordedPaymentOption,
  alreadyRecordedCandidates,
  formatStatementAmount,
} from '@/lib/kcbStatementImport';

type PaidMonth = { id: string; month: string; paid: number };

const toggle = (list: string[], id: string, checked: boolean) =>
  checked ? [...list, id] : list.filter((value) => value !== id);

/**
 * Links a payment imported from a KCB statement to the member's payments or
 * paid months that already account for it. No balance changes; the payment
 * only leaves the queue, and the link can be undone.
 */
export const DialogAlreadyRecorded = ({
  open,
  onOpenChange,
  payment,
  memberId,
  memberName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: KcbPaymentNotification;
  memberId: string;
  memberName: string;
}) => {
  const [payments, setPayments] = React.useState<RecordedPaymentOption[]>();
  const [months, setMonths] = React.useState<PaidMonth[]>();
  const [paymentIds, setPaymentIds] = React.useState<string[]>([]);
  const [contributionIds, setContributionIds] = React.useState<string[]>([]);
  const [reason, setReason] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const paidOn = payment.paidAt?.toDate();

  React.useEffect(() => {
    if (!open) return;
    setPaymentIds([]);
    setContributionIds([]);
    setReason('');
    setError(undefined);
    setPayments(undefined);
    setMonths(undefined);
    let active = true;
    void Promise.all([
      getDocs(collection(db, `members/${memberId}/payments`)),
      getDocs(collection(db, `members/${memberId}/contributions`)),
    ])
      .then(([paymentSnapshot, contributionSnapshot]) => {
        if (!active) return;
        setPayments(
          alreadyRecordedCandidates(
            paymentSnapshot.docs.map((item) => {
              const data = item.data();
              return {
                id: item.id,
                amount: Number(data.amount) || 0,
                reference: String(data.referencenumber ?? ''),
                paidOn:
                  data.paymentdate instanceof Timestamp
                    ? data.paymentdate.toDate()
                    : undefined,
              };
            }),
            paidOn,
          ),
        );
        setMonths(
          contributionSnapshot.docs
            .map((item) => {
              const data = item.data();
              return {
                id: item.id,
                month: String(data.month ?? item.id),
                paid: (Number(data.amount) || 0) - (Number(data.balance) || 0),
                status: data.paid,
              };
            })
            .filter(
              (item) => item.status === 'paid' || item.status === 'partial',
            )
            .sort((left, right) => right.month.localeCompare(left.month)),
        );
      })
      .catch(() => {
        if (active) setError('The member’s payments could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, [open, memberId, paidOn?.getTime()]);

  const nothingChosen = !paymentIds.length && !contributionIds.length;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (nothingChosen || !reason.trim() || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      await markKcbPaymentAlreadyRecorded({
        providerTransactionId: payment.providerTransactionId,
        memberId,
        paymentIds,
        contributionIds,
        reason: reason.trim(),
      });
      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'The action did not complete.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!loading) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Already recorded</DialogTitle>
            <DialogDescription className="mt-1 text-sm leading-6">
              Choose what already accounts for this{' '}
              {formatStatementAmount(payment.amount)} payment in {memberName}’s
              records. No balance changes; the payment leaves the queue and the
              link can be undone.
            </DialogDescription>
          </DialogHeader>
          {payments === undefined || months === undefined ? (
            error ? null : (
              <p role="status" className="text-sm text-gray-600">
                Loading the member’s payments…
              </p>
            )
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">
                  Payments near{' '}
                  {paidOn ? formatEatDate(paidOn) : 'the payment date'}
                </legend>
                {payments.length ? (
                  <div className="max-h-56 space-y-2.5 overflow-y-auto rounded-md border border-gray-200 p-3 dark:border-gray-800">
                    {payments.map((item) => (
                      <div key={item.id} className="flex items-start gap-2">
                        <Checkbox
                          id={`recorded-payment-${item.id}`}
                          checked={paymentIds.includes(item.id)}
                          onCheckedChange={(checked) =>
                            setPaymentIds((current) =>
                              toggle(current, item.id, checked === true),
                            )
                          }
                        />
                        <Label
                          htmlFor={`recorded-payment-${item.id}`}
                          className="text-sm"
                        >
                          {formatStatementAmount(item.amount)}
                          <span className="block text-xs text-gray-500">
                            {item.paidOn ? formatEatDate(item.paidOn) : ''}
                            {item.reference ? ` · ${item.reference}` : ''}
                          </span>
                        </Label>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">
                    No payments within six months.
                  </p>
                )}
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Paid months</legend>
                {months.length ? (
                  <div className="max-h-56 space-y-2.5 overflow-y-auto rounded-md border border-gray-200 p-3 dark:border-gray-800">
                    {months.map((item) => (
                      <div key={item.id} className="flex items-start gap-2">
                        <Checkbox
                          id={`recorded-month-${item.id}`}
                          checked={contributionIds.includes(item.id)}
                          onCheckedChange={(checked) =>
                            setContributionIds((current) =>
                              toggle(current, item.id, checked === true),
                            )
                          }
                        />
                        <Label
                          htmlFor={`recorded-month-${item.id}`}
                          className="text-sm"
                        >
                          {item.month}
                          <span className="block text-xs text-gray-500">
                            {formatStatementAmount(item.paid)} paid
                          </span>
                        </Label>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No paid months.</p>
                )}
              </fieldset>
            </div>
          )}
          <div className="space-y-1">
            <Label
              htmlFor={`already-recorded-${payment.providerTransactionId}`}
            >
              How it was recorded
            </Label>
            <Textarea
              id={`already-recorded-${payment.providerTransactionId}`}
              required
              rows={3}
              placeholder="e.g. Recorded by hand in April without the M-Pesa code"
              value={reason}
              disabled={loading}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          {error ? (
            <Callout title="Could not complete" variant="error" role="alert">
              {error}
            </Callout>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button
                className="mt-2 w-full sm:mt-0 sm:w-fit"
                variant="secondary"
                type="button"
                disabled={loading}
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              className="w-full sm:w-fit"
              type="submit"
              isLoading={loading}
              loadingText="Linking"
              disabled={nothingChosen || !reason.trim()}
            >
              Mark already recorded
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
