import React, { useState } from 'react';
import { Contribution, Member, Payment } from 'tmbwa-shared/firebase';
import { printStatement } from '@/lib/memberDocuments';
import { Button } from '@/components/Button';
import { Label } from '@/components/Label';
import { DatePicker } from '@/components/DatePicker';
import { calendarDate, calendarDateValue } from '@/lib/financialReporting';
import { cx } from '@/lib/utils';

interface StatementPrintProps extends React.ComponentPropsWithoutRef<'div'> {
  member: Member;
  contributions: Contribution[];
  payments: Payment[];
}

export function StatementPrint({
  member,
  contributions,
  payments,
  className,
  ...props
}: StatementPrintProps) {
  const [statementFrom, setStatementFrom] = useState('');
  const [statementTo, setStatementTo] = useState('');

  return (
    <div
      className={cx(
        'flex flex-wrap items-end gap-3 rounded border p-3',
        className,
      )}
      {...props}
    >
      <div className="space-y-1">
        <Label htmlFor="statement-from">Statement from</Label>
        <DatePicker
          id="statement-from"
          className="mt-1"
          placeholder="Select start date"
          enableYearNavigation
          value={calendarDate(statementFrom)}
          onChange={(date) => setStatementFrom(calendarDateValue(date))}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="statement-to">To</Label>
        <DatePicker
          id="statement-to"
          className="mt-1"
          placeholder="Select end date"
          enableYearNavigation
          value={calendarDate(statementTo)}
          onChange={(date) => setStatementTo(calendarDateValue(date))}
        />
      </div>
      <Button
        type="button"
        onClick={() =>
          printStatement(
            member,
            contributions,
            payments,
            statementFrom,
            statementTo,
          )
        }
      >
        Print statement
      </Button>
    </div>
  );
}
