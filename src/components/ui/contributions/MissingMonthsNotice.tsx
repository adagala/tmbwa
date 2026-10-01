import { Member } from 'tmbwa-shared/firebase';
import { DialogAddMissingContributions } from '@/components/ui/contributions/DialogAddMissingContributions';
import { formatNairobiMonth, monthLabel } from '@/lib/financialReporting';
import { previewMissingMonths } from '@/lib/missingMonths';
import { cx } from '@/lib/utils';

const formatKes = (value: number) =>
  `KES ${value < 0 ? '−' : ''}${Math.abs(value).toLocaleString('en-US', {
    maximumFractionDigits: 2,
  })}`;

function MonthChips({ months }: { months: string[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {months.map((month) => (
        <span
          key={month}
          className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300"
        >
          {monthLabel(month)}
        </span>
      ))}
    </div>
  );
}

// Administrators see what adding the months would do and can act on it.
export function MissingMonthsAdminNotice({
  member,
  missingMonths,
}: {
  member: Member;
  missingMonths: string[];
}) {
  const preview = previewMissingMonths(missingMonths, member);
  const count = missingMonths.length;
  return (
    <div className="mb-4 flex flex-col gap-4 rounded-lg border border-red-200 border-l-4 border-l-guardsman-red-500 bg-white px-4 py-3.5 sm:grid sm:grid-cols-[1fr_auto] sm:items-center dark:border-red-900/60 dark:border-l-guardsman-red-400 dark:bg-gray-950">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">
          {count} {count === 1 ? 'month' : 'months'} not billed since{' '}
          {member.firstname} joined
        </h3>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Adding {count === 1 ? 'it' : 'them'} bills {formatKes(preview.total)}.
          {preview.fromCredit > 0
            ? ` ${formatKes(preview.fromCredit)} of credit covers the oldest.`
            : ''}
        </p>
        <MonthChips months={missingMonths} />
      </div>
      <div className="flex flex-col gap-2.5 sm:items-end">
        <div className="text-xs text-gray-500 sm:text-right dark:text-gray-400">
          Balance after
          <span
            className={cx(
              'block text-base font-semibold tabular-nums',
              preview.balanceAfter < 0
                ? 'text-red-600 dark:text-red-500'
                : 'text-gray-900 dark:text-gray-50',
            )}
          >
            {formatKes(preview.balanceAfter)}
          </span>
        </div>
        {member.status === 'active' ? (
          <DialogAddMissingContributions
            member={member}
            missingMonths={missingMonths}
          />
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Reactivate the member to add{' '}
            {count === 1 ? 'this month' : 'these months'}.
          </p>
        )}
      </div>
    </div>
  );
}

// Members get a calm explanation: nothing is owed until the months are added.
export function MissingMonthsMemberNotice({
  joinedAt,
  missingMonths,
}: {
  joinedAt: Date;
  missingMonths: string[];
}) {
  const single = missingMonths.length === 1;
  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
      <h3 className="mb-1 font-semibold text-slate-900 dark:text-slate-50">
        {single
          ? 'A month isn’t on your record yet'
          : 'Some months aren’t on your record yet'}
      </h3>
      <p>
        Since you joined in {formatNairobiMonth(joinedAt)},{' '}
        {single ? 'this month has' : 'these months have'} no contribution:
      </p>
      <MonthChips months={missingMonths} />
      <p className="mt-2">
        You aren’t charged for {single ? 'it' : 'them'} until an administrator
        adds {single ? 'it' : 'them'}. Questions? Contact an administrator.
      </p>
    </div>
  );
}
