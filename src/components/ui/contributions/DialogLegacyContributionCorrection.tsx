import React from 'react';
import { RiHistoryLine } from '@remixicon/react';
import { Button } from '@/components/Button';
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
import { toast } from '@/hooks/useToast';
import { correctLegacyContribution } from '@/lib/firebase/financial';
import { Contribution } from 'tmbwa-shared/firebase';
import { DatePicker } from '@/components/DatePicker';
import { calendarDate, calendarDateValue } from '@/lib/financialReporting';

export const DialogLegacyContributionCorrection = ({
  contribution,
}: {
  contribution: Contribution;
}) => {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [paidAmount, setPaidAmount] = React.useState(
    String(Number(contribution.amount) - Number(contribution.balance)),
  );
  const [reason, setReason] = React.useState('');
  const [reference, setReference] = React.useState('');
  const [paymentDate, setPaymentDate] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const corrected = Number(paidAmount);
  const currentPaid =
    Number(contribution.amount) - Number(contribution.balance);
  const delta = corrected - currentPaid;
  const valid =
    Number.isFinite(corrected) &&
    corrected >= 0 &&
    corrected <= Number(contribution.amount) &&
    delta !== 0 &&
    reason.trim().length > 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setLoading(true);
    try {
      await correctLegacyContribution({
        contribution,
        correctedPaidAmount: corrected,
        reason: reason.trim(),
        reference: reference.trim(),
        notes: notes.trim(),
        originalPaymentDate: paymentDate || undefined,
      });
      setOpen(false);
      toast({
        title: 'Legacy contribution corrected',
        description: `Contribution total changed by KES ${delta}.`,
        variant: 'success',
      });
    } catch (error) {
      toast({
        title: 'Correction failed',
        description: (error as Error).message,
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" className="h-8 gap-1 text-xs">
          <RiHistoryLine className="size-4" /> Correct legacy record
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Legacy contribution correction</DialogTitle>
            <DialogDescription>
              This records a verified historical correction. It does not create
              a KCB payment or receipt. Current paid amount: KES {currentPaid}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="legacy-paid-amount">Correct paid amount</Label>
              <Input
                id="legacy-paid-amount"
                type="number"
                min="0"
                max={contribution.amount}
                step="0.01"
                required
                value={paidAmount}
                onChange={(event) => setPaidAmount(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="legacy-reason">Reason</Label>
              <Input
                id="legacy-reason"
                required
                value={reason}
                placeholder="Why is this historical record being corrected?"
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="legacy-reference">
                  Original reference (optional)
                </Label>
                <Input
                  id="legacy-reference"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="legacy-date">
                  Original payment date (optional)
                </Label>
                <DatePicker
                  id="legacy-date"
                  placeholder="Select payment date"
                  enableYearNavigation
                  value={calendarDate(paymentDate)}
                  onChange={(date) => setPaymentDate(calendarDateValue(date))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="legacy-notes">Supporting notes (optional)</Label>
              <Input
                id="legacy-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
            {Number.isFinite(delta) && delta !== 0 ? (
              <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
                Confirmed financial delta: {delta > 0 ? '+' : ''}KES {delta}.
                This updates the contribution, member totals, monthly
                statistics, and audit history.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!valid || loading}>
              {loading ? 'Saving…' : 'Confirm correction'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
