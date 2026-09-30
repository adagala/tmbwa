import React from 'react';
import { RiCalendarCheckLine } from '@remixicon/react';
import {
  MAX_CONTRIBUTION_MONTHS_PER_REQUEST,
  MONTHLY_CONTRIBUTION,
} from 'tmbwa-shared';
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
import { toast } from '@/hooks/useToast';
import { addContributions } from '@/lib/firebase/financial';
import { kenyaMoney, monthLabel } from '@/lib/financialReporting';

export const DialogAddMissingContributions = ({
  member,
  missingMonths,
}: {
  member: Member;
  missingMonths: string[];
}) => {
  const [open, setOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]);

  // The list is live, so drop selections that another action has billed.
  const selectedMonths = selected.filter((month) =>
    missingMonths.includes(month),
  );
  const allSelected =
    selectedMonths.length > 0 && selectedMonths.length === missingMonths.length;
  const tooMany = selectedMonths.length > MAX_CONTRIBUTION_MONTHS_PER_REQUEST;
  const total = selectedMonths.length * MONTHLY_CONTRIBUTION;
  // Estimate only; the server applies unreserved credit authoritatively.
  const credit = Math.min(
    Math.max((member.balance || 0) - (member.reservedKcbCredit || 0), 0),
    total,
  );

  const toggleMonth = (month: string, checked: boolean) =>
    setSelected((current) =>
      checked
        ? [...current, month]
        : current.filter((value) => value !== month),
    );

  const onOpenChange = (value: boolean) => {
    setOpen(value);
    if (!value) setSelected([]);
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (selectedMonths.length === 0 || tooMany) return;
    setIsLoading(true);
    try {
      await addContributions({
        member,
        months: [...selectedMonths].sort(),
      });
      onOpenChange(false);
      toast({
        title: 'Success',
        description: `${selectedMonths.length} ${
          selectedMonths.length === 1 ? 'contribution' : 'contributions'
        } added`,
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
        <Button variant="primary" className="w-full gap-1 sm:w-auto">
          <RiCalendarCheckLine className="size-4" aria-hidden="true" />
          Add missing months
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Add missing months</DialogTitle>
            <DialogDescription className="mt-1 text-sm leading-6">
              Months since {member.firstname} joined that have no contribution.
              Each month is billed at {kenyaMoney.format(MONTHLY_CONTRIBUTION)}.
              Account credit pays the oldest selected month first.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 flex items-center gap-2 border-b border-gray-200 pb-3 dark:border-gray-800">
            <Checkbox
              id="missing-months-all"
              checked={
                allSelected
                  ? true
                  : selectedMonths.length > 0
                    ? 'indeterminate'
                    : false
              }
              onCheckedChange={() =>
                setSelected(allSelected ? [] : [...missingMonths])
              }
            />
            <Label htmlFor="missing-months-all" className="font-medium">
              Select all ({missingMonths.length})
            </Label>
          </div>
          <div className="max-h-72 space-y-3 overflow-y-auto py-3">
            {missingMonths.map((month) => (
              <div key={month} className="flex items-center gap-2">
                <Checkbox
                  id={`missing-month-${month}`}
                  checked={selectedMonths.includes(month)}
                  onCheckedChange={(checked) =>
                    toggleMonth(month, checked === true)
                  }
                />
                <Label htmlFor={`missing-month-${month}`}>
                  {monthLabel(month)}
                </Label>
              </div>
            ))}
          </div>

          <div className="space-y-1 border-t border-gray-200 pt-3 text-sm text-gray-700 dark:border-gray-800 dark:text-gray-300">
            <p>
              {selectedMonths.length} selected · {kenyaMoney.format(total)}
            </p>
            {credit > 0 ? (
              <p className="text-gray-500 dark:text-gray-400">
                About {kenyaMoney.format(credit)} of account credit will be
                applied.
              </p>
            ) : null}
            {tooMany ? (
              <p className="text-red-600 dark:text-red-500">
                Select at most {MAX_CONTRIBUTION_MONTHS_PER_REQUEST} months at a
                time.
              </p>
            ) : null}
          </div>

          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button
                className="mt-2 w-full sm:mt-0 sm:w-fit"
                variant="secondary"
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              className="w-full sm:w-fit"
              type="submit"
              disabled={selectedMonths.length === 0 || tooMany}
              isLoading={isLoading}
              loadingText="Saving"
            >
              Add {selectedMonths.length || ''}{' '}
              {selectedMonths.length === 1 ? 'month' : 'months'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
