import React from 'react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Callout } from '@/components/Callout';
import { Card } from '@/components/Card';
import { Checkbox } from '@/components/Checkbox';
import { DateRangePicker } from '@/components/DatePicker';
import { Input } from '@/components/Input';
import { Label } from '@/components/Label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRoot,
  TableRow,
} from '@/components/Table';
import { DialogKcbAction } from '@/components/ui/kcb/DialogKcbAction';
import { importKcbStatement, previewKcbStatement } from '@/lib/firebase/kcb';
import {
  IsoDateRange,
  MAX_STATEMENT_PDF_BYTES,
  StatementImportResult,
  StatementPreview,
  bytesToBase64,
  formatStatementAmount,
  isSelectableRow,
  isoDate,
  localDate,
  rowsInRange,
  statementOutcomeCounts,
  statementOutcomeLabel,
  statementOutcomeVariant,
  statementRangePresets,
} from '@/lib/kcbStatementImport';

const errorMessage = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.message ? cause.message : fallback;

const rangeLabel = (range: IsoDateRange) =>
  `${range.from ?? 'start'} to ${range.to ?? 'end'}`;

/**
 * Uploads a KCB account statement PDF, shows what the server would do with
 * each row, and imports the payments the treasurer selects, optionally within
 * a date range, into the reconciliation queue. Nothing here changes a member
 * balance.
 */
export const StatementImportCard = ({
  memberNames,
}: {
  memberNames: Map<string, string>;
}) => {
  const [file, setFile] = React.useState<{ name: string; base64: string }>();
  const [inputKey, setInputKey] = React.useState(0);
  const [preview, setPreview] = React.useState<StatementPreview>();
  const [range, setRange] = React.useState<IsoDateRange>({});
  const [selected, setSelected] = React.useState<string[]>([]);
  const [checking, setChecking] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [result, setResult] = React.useState<StatementImportResult>();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  // One run per confirmed import; a retry of the same import reuses it.
  const requestId = React.useRef<string>();

  const reset = () => {
    setFile(undefined);
    setPreview(undefined);
    setSelected([]);
    setRange({});
    setInputKey((key) => key + 1);
  };

  const check = async (base64: string) => {
    const next = await previewKcbStatement(base64);
    setPreview(next);
    return next;
  };

  const choose = async (chosen: File | undefined) => {
    setError(undefined);
    setResult(undefined);
    setPreview(undefined);
    setSelected([]);
    setFile(undefined);
    if (!chosen) return;
    if (chosen.size > MAX_STATEMENT_PDF_BYTES) {
      setError('The statement PDF is larger than 5 MB.');
      return;
    }
    setChecking(true);
    try {
      const base64 = bytesToBase64(new Uint8Array(await chosen.arrayBuffer()));
      const checked = await check(base64);
      setRange({
        from: checked.header.periodStart,
        to: checked.header.periodEnd,
      });
      setFile({ name: chosen.name, base64 });
    } catch (cause) {
      setError(errorMessage(cause, 'The statement could not be checked.'));
    } finally {
      setChecking(false);
    }
  };

  const presets = React.useMemo(
    () =>
      preview
        ? statementRangePresets(
            preview.header.periodStart,
            preview.header.periodEnd,
          ).map((preset) => ({
            label: preset.label,
            dateRange: {
              from: localDate(preset.from),
              to: localDate(preset.to),
            },
          }))
        : [],
    [preview],
  );
  const pickerValue = React.useMemo(
    () => ({
      from: range.from ? localDate(range.from) : undefined,
      to: range.to ? localDate(range.to) : undefined,
    }),
    [range],
  );

  const shown = rowsInRange(preview?.rows ?? [], range);
  const counts = statementOutcomeCounts(shown);
  const selectable = shown.filter(isSelectableRow);
  const toImport = selectable.filter((row) =>
    selected.includes(row.receipt as string),
  );
  const importTotal = toImport.reduce((sum, row) => sum + row.moneyIn, 0);
  const checkedCount = toImport.filter(
    (row) => row.outcome === 'matched_check',
  ).length;

  const toggle = (receipt: string, checked: boolean) =>
    setSelected((current) =>
      checked
        ? [...current, receipt]
        : current.filter((value) => value !== receipt),
    );

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Import a KCB statement</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Upload the KCB account statement PDF, choose a date range, and tick
          the payments to bring into this queue. Payments the app already has
          are marked and cannot be imported again, and no member balance changes
          until you reconcile each payment.
        </p>
      </div>
      <div className="max-w-md space-y-1">
        <Label htmlFor="kcb-statement-file">Statement PDF</Label>
        <Input
          key={inputKey}
          id="kcb-statement-file"
          type="file"
          accept="application/pdf,.pdf"
          disabled={checking}
          onChange={(event) => void choose(event.target.files?.[0])}
        />
      </div>
      {checking ? (
        <p role="status" className="text-sm text-gray-600">
          Checking the statement…
        </p>
      ) : null}
      {error ? (
        <Callout title="Could not use this file" variant="error" role="alert">
          {error}
        </Callout>
      ) : null}
      {result ? (
        <Callout
          title={
            result.duplicate
              ? 'These payments were already imported'
              : 'Payments imported'
          }
          variant="success"
          role="status"
        >
          {`${result.counts.imported ?? 0} payment(s) were added to the queue below.`}
          {result.counts.already_in_app
            ? ` ${result.counts.already_in_app} were already in the app and were skipped.`
            : ''}
        </Callout>
      ) : null}
      {preview?.problems.length ? (
        <Callout
          title="This statement cannot be imported"
          variant="error"
          role="alert"
        >
          <ul className="list-disc pl-5">
            {preview.problems.map((problem, index) => (
              <li key={`${problem.code}-${index}`}>{problem.message}</li>
            ))}
          </ul>
        </Callout>
      ) : null}
      {preview && !preview.problems.length ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-full max-w-xs space-y-1">
              <Label htmlFor="kcb-statement-range">Show payments from</Label>
              <DateRangePicker
                id="kcb-statement-range"
                value={pickerValue}
                presets={presets}
                enableYearNavigation
                onChange={(value) =>
                  setRange({
                    from: value?.from ? isoDate(value.from) : undefined,
                    to: value?.to ? isoDate(value.to) : undefined,
                  })
                }
              />
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Statement period: {preview.header.periodStart} to{' '}
              {preview.header.periodEnd}
            </p>
          </div>
          <dl className="grid gap-2 rounded-md bg-gray-50 p-3 text-sm sm:grid-cols-4 dark:bg-gray-900">
            <div>
              <dt className="text-gray-500">New in range</dt>
              <dd className="font-semibold">{counts.new}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Need a check</dt>
              <dd className="font-semibold">{counts.matched_check}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Already in the app</dt>
              <dd className="font-semibold">{counts.already_in_app}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Selected</dt>
              <dd className="font-semibold">
                {toImport.length} · {formatStatementAmount(importTotal)}
              </dd>
            </div>
          </dl>
          {counts.matched_check ? (
            <Callout title="Some payments need a check" variant="warning">
              Their M-Pesa code is on a payment recorded earlier, but that
              payment does not clearly match. Tick one only after confirming it
              is not already counted.
            </Callout>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={!counts.new}
              onClick={() =>
                setSelected((current) => [
                  ...new Set([
                    ...current,
                    ...shown
                      .filter((row) => row.outcome === 'new' && row.receipt)
                      .map((row) => row.receipt as string),
                  ]),
                ])
              }
            >
              Select all new in range
            </Button>
            <Button
              variant="secondary"
              disabled={!selected.length}
              onClick={() => setSelected([])}
            >
              Clear selection
            </Button>
          </div>
          {shown.length ? (
            <TableRoot className="max-h-[28rem] overflow-y-auto">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>
                      <span className="sr-only">Import</span>
                    </TableHeaderCell>
                    <TableHeaderCell>Date</TableHeaderCell>
                    <TableHeaderCell>Payment</TableHeaderCell>
                    <TableHeaderCell>Payer</TableHeaderCell>
                    <TableHeaderCell className="text-right">
                      Amount
                    </TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {shown.map((row) => {
                    const matchedMembers = (row.matchedMemberIds ?? [])
                      .map((id) => memberNames.get(id) ?? id)
                      .join(', ');
                    const receipt = row.receipt;
                    return (
                      <TableRow key={row.index}>
                        <TableCell className="w-10">
                          {receipt && isSelectableRow(row) ? (
                            <Checkbox
                              id={`statement-select-${receipt}`}
                              aria-label={`Import ${receipt}`}
                              checked={selected.includes(receipt)}
                              onCheckedChange={(checked) =>
                                toggle(receipt, checked === true)
                              }
                            />
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {row.transactionDate}
                        </TableCell>
                        <TableCell>
                          {receipt ? (
                            <span className="font-mono font-semibold">
                              {receipt}
                            </span>
                          ) : (
                            <span className="text-gray-500">{row.details}</span>
                          )}
                          {row.bankReference ? (
                            <span className="block font-mono text-xs text-gray-500">
                              {row.bankReference}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {row.payerName ?? ''}
                          {row.payerPhone ? (
                            <span className="block text-xs text-gray-500">
                              {row.payerPhone}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          {row.moneyIn
                            ? formatStatementAmount(row.moneyIn)
                            : row.moneyOut
                              ? `−${formatStatementAmount(row.moneyOut)}`
                              : ''}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statementOutcomeVariant(row.outcome)}>
                            {statementOutcomeLabel(row)}
                          </Badge>
                          {matchedMembers ? (
                            <span className="mt-1 block text-xs text-gray-500">
                              {matchedMembers}
                            </span>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableRoot>
          ) : (
            <p className="text-sm text-gray-500">
              No statement rows in this date range.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!toImport.length}
              onClick={() => {
                requestId.current = crypto.randomUUID();
                setConfirmOpen(true);
              }}
            >
              Import {toImport.length} selected payment
              {toImport.length === 1 ? '' : 's'}
            </Button>
            <Button variant="secondary" onClick={reset}>
              Close statement
            </Button>
          </div>
        </div>
      ) : null}
      {file && preview ? (
        <DialogKcbAction
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Import selected payments"
          description="The selected payments are added to the reconciliation queue as unresolved. No member balance changes until you reconcile them one by one."
          summary={[
            { label: 'File', value: file.name },
            { label: 'Date range', value: rangeLabel(range) },
            { label: 'Payments', value: String(toImport.length) },
            { label: 'Total', value: formatStatementAmount(importTotal) },
            ...(checkedCount
              ? [{ label: 'Needing a check', value: String(checkedCount) }]
              : []),
          ]}
          confirmLabel="Import payments"
          loadingText="Importing"
          onConfirm={async () => {
            const imported = await importKcbStatement({
              requestId: requestId.current ?? crypto.randomUUID(),
              pdfBase64: file.base64,
              fileName: file.name,
              receipts: toImport.map((row) => row.receipt as string),
              ...(range.from ? { fromDate: range.from } : {}),
              ...(range.to ? { toDate: range.to } : {}),
            });
            setResult(imported);
            setSelected([]);
            requestId.current = undefined;
            // Keep the statement open for the next range; imported payments
            // now show as imported earlier.
            await check(file.base64).catch(() => undefined);
          }}
        />
      ) : null}
    </Card>
  );
};
