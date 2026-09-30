import React from 'react';
import { RiCheckLine } from '@remixicon/react';
import { MAX_CONTRIBUTION_MONTHS_PER_REQUEST } from 'tmbwa-shared';
import { Member } from 'tmbwa-shared/firebase';
import { Button } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
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
import { Label } from '@/components/Label';
import {
  RadioCardGroup,
  RadioCardGroupIndicator,
  RadioCardItem,
} from '@/components/RadioCard';
import { toast } from '@/hooks/useToast';
import { addContributions } from '@/lib/firebase/financial';
import { monthLabel } from '@/lib/financialReporting';
import {
  monthsCoveredByCredit,
  previewMissingMonths,
} from '@/lib/missingMonths';
import { cx } from '@/lib/utils';

type Choice = 'all' | 'credit' | 'pick';
type Step = 'choose' | 'review';

const formatKes = (value: number) =>
  `KES ${value < 0 ? '−' : ''}${Math.abs(value).toLocaleString('en-US', {
    maximumFractionDigits: 2,
  })}`;

const monthCount = (count: number) =>
  `${count} ${count === 1 ? 'month' : 'months'}`;

const monthRange = (months: string[]) =>
  months.length === 1
    ? monthLabel(months[0])
    : `${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])}`;

function Steps({ step }: { step: Step }) {
  const item = (label: string, index: number, state: 'on' | 'done' | 'off') => (
    <span
      className={cx(
        'inline-flex items-center gap-1.5',
        state === 'off'
          ? 'text-gray-400 dark:text-gray-600'
          : 'text-gray-900 dark:text-gray-50',
        state === 'on' && 'font-semibold',
      )}
    >
      <span
        className={cx(
          'inline-flex size-[18px] items-center justify-center rounded-full border text-[11px]',
          state === 'on' &&
            'border-guardsman-red-500 bg-guardsman-red-500 text-white',
          state === 'done' &&
            'border-gray-900 bg-gray-900 text-white dark:border-gray-50 dark:bg-gray-50 dark:text-gray-900',
          state === 'off' && 'border-gray-300 dark:border-gray-700',
        )}
        aria-hidden="true"
      >
        {state === 'done' ? <RiCheckLine className="size-3" /> : index}
      </span>
      {label}
    </span>
  );
  return (
    <div
      className="mb-4 flex items-center gap-2 text-xs"
      aria-label={`Step ${step === 'choose' ? 1 : 2} of 2`}
    >
      {item('Choose months', 1, step === 'choose' ? 'on' : 'done')}
      <span className="text-gray-400" aria-hidden="true">
        ›
      </span>
      {item('Review', 2, step === 'review' ? 'on' : 'off')}
    </div>
  );
}

export const DialogAddMissingContributions = ({
  member,
  missingMonths,
}: {
  member: Member;
  missingMonths: string[];
}) => {
  const [open, setOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [step, setStep] = React.useState<Step>('choose');
  const [choice, setChoice] = React.useState<Choice>('all');
  const [picked, setPicked] = React.useState<string[]>([]);

  const covered = monthsCoveredByCredit(missingMonths, member);
  const offerCredit =
    covered.length > 0 && covered.length < missingMonths.length;
  // The list is live, so drop picks that another action has billed.
  const selectedMonths = (
    choice === 'all'
      ? missingMonths
      : choice === 'credit'
        ? covered
        : picked.filter((month) => missingMonths.includes(month))
  )
    .slice()
    .sort();
  const tooMany = selectedMonths.length > MAX_CONTRIBUTION_MONTHS_PER_REQUEST;
  const preview = previewMissingMonths(selectedMonths, member);
  const allPreview = previewMissingMonths(missingMonths, member);
  const coveredPreview = previewMissingMonths(covered, member);
  const firstName = member.firstname;

  const onOpenChange = (value: boolean) => {
    setOpen(value);
    if (!value) {
      setStep('choose');
      setChoice('all');
      setPicked([]);
    }
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (step === 'choose') {
      if (selectedMonths.length > 0 && !tooMany) setStep('review');
      return;
    }
    setIsLoading(true);
    try {
      await addContributions({ member, months: selectedMonths });
      onOpenChange(false);
      toast({
        title: 'Success',
        description: `${monthCount(selectedMonths.length)} added`,
        variant: 'success',
        duration: 3000,
      });
    } catch (error) {
      toast({
        title: 'Error',
        description:
          (error as { message?: string })?.message ||
          'Error adding contributions',
        variant: 'error',
        duration: 5000,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="primary"
          className="w-full whitespace-nowrap sm:w-auto"
        >
          Add missing months
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit}>
          <Steps step={step} />
          {step === 'choose' ? (
            <>
              <DialogHeader>
                <DialogTitle>Which months should be added?</DialogTitle>
                <DialogDescription className="sr-only">
                  Choose the missing months to bill for {firstName}.
                </DialogDescription>
              </DialogHeader>
              <RadioCardGroup
                className="mt-4"
                value={choice}
                onValueChange={(value) => setChoice(value as Choice)}
              >
                <RadioCardItem value="all" className="px-3 py-2.5">
                  <div className="flex items-start gap-2.5">
                    <RadioCardGroupIndicator className="mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                        {missingMonths.length === 1
                          ? 'The missing month'
                          : `All ${missingMonths.length} missing months`}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {monthRange(missingMonths)} ·{' '}
                        {formatKes(allPreview.total)}
                      </p>
                    </div>
                  </div>
                </RadioCardItem>
                {offerCredit ? (
                  <RadioCardItem value="credit" className="px-3 py-2.5">
                    <div className="flex items-start gap-2.5">
                      <RadioCardGroupIndicator className="mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                          Only those credit covers in full
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {monthRange(covered)} ·{' '}
                          {formatKes(coveredPreview.total)}
                        </p>
                      </div>
                    </div>
                  </RadioCardItem>
                ) : null}
                <RadioCardItem value="pick" className="px-3 py-2.5">
                  <div className="flex items-start gap-2.5">
                    <RadioCardGroupIndicator className="mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                        Let me pick
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Choose individual months from a list
                      </p>
                    </div>
                  </div>
                </RadioCardItem>
              </RadioCardGroup>
              {choice === 'pick' ? (
                <div className="mt-3 max-h-56 space-y-2.5 overflow-y-auto rounded-md border border-gray-200 p-3 dark:border-gray-800">
                  {missingMonths.map((month) => (
                    <div key={month} className="flex items-center gap-2">
                      <Checkbox
                        id={`missing-month-${month}`}
                        checked={picked.includes(month)}
                        onCheckedChange={(checked) =>
                          setPicked((current) =>
                            checked === true
                              ? [...current, month]
                              : current.filter((value) => value !== month),
                          )
                        }
                      />
                      <Label htmlFor={`missing-month-${month}`}>
                        {monthLabel(month)}
                      </Label>
                    </div>
                  ))}
                </div>
              ) : null}
              {tooMany ? (
                <p className="mt-3 text-xs text-red-600 dark:text-red-500">
                  Select at most {MAX_CONTRIBUTION_MONTHS_PER_REQUEST} months at
                  a time.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>
                  Add {monthCount(selectedMonths.length)} for {firstName}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Review how each month will be billed before adding it.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-3 max-h-64 overflow-y-auto">
                {preview.rows.map((row) => (
                  <div
                    key={row.month}
                    className="grid grid-cols-[6.5rem_1fr] gap-2.5 border-b border-gray-100 py-2 text-sm last:border-b-0 dark:border-gray-800"
                  >
                    <span className="font-semibold text-gray-900 dark:text-gray-50">
                      {monthLabel(row.month)}
                    </span>
                    <span className="text-gray-700 dark:text-gray-300">
                      {row.due === 0
                        ? 'Paid in full from credit'
                        : row.fromCredit > 0
                          ? `${formatKes(row.fromCredit)} from credit, ${formatKes(row.due)} left to pay`
                          : `${formatKes(row.due)} to pay`}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex justify-between rounded-md bg-gray-50 px-3 py-2.5 text-sm dark:bg-gray-900">
                <span className="text-gray-700 dark:text-gray-300">
                  {preview.balanceAfter < 0
                    ? `${firstName} will owe`
                    : 'Credit left after'}
                </span>
                <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-50">
                  {formatKes(Math.abs(preview.balanceAfter))}
                </span>
              </div>
              <p className="mt-2.5 text-xs text-gray-500 dark:text-gray-400">
                {preview.rows.some((row) => row.due > 0)
                  ? `${firstName} gets one notification. `
                  : ''}
                Each month is recorded in the audit log under your name.
              </p>
            </>
          )}
          <DialogFooter className="mt-6">
            {step === 'choose' ? (
              <DialogClose asChild>
                <Button
                  type="button"
                  className="mt-2 w-full sm:mt-0 sm:w-fit"
                  variant="secondary"
                >
                  Cancel
                </Button>
              </DialogClose>
            ) : (
              <Button
                type="button"
                className="mt-2 w-full sm:mt-0 sm:w-fit"
                variant="secondary"
                onClick={() => setStep('choose')}
                disabled={isLoading}
              >
                Back
              </Button>
            )}
            <Button
              className="w-full sm:w-fit"
              type="submit"
              disabled={selectedMonths.length === 0 || tooMany}
              isLoading={isLoading}
              loadingText="Saving"
            >
              {step === 'choose'
                ? 'Continue'
                : `Add ${monthCount(selectedMonths.length)}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
