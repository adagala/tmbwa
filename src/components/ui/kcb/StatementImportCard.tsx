import React from 'react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Callout } from '@/components/Callout';
import { Card } from '@/components/Card';
import { Checkbox } from '@/components/Checkbox';
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
  MAX_STATEMENT_PDF_BYTES,
  StatementImportResult,
  StatementPreview,
  bytesToBase64,
  formatStatementAmount,
  statementOutcomeCounts,
  statementOutcomeLabel,
  statementOutcomeVariant,
} from '@/lib/kcbStatementImport';

const errorMessage = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.message ? cause.message : fallback;

/**
 * Uploads a KCB account statement PDF, shows what the server would do with
 * each row, and imports the new M-Pesa payments into the reconciliation
 * queue. Nothing here changes a member balance.
 */
export const StatementImportCard = ({
  memberNames,
}: {
  memberNames: Map<string, string>;
}) => {
  const [file, setFile] = React.useState<{ name: string; base64: string }>();
  const [inputKey, setInputKey] = React.useState(0);
  const [preview, setPreview] = React.useState<StatementPreview>();
  const [include, setInclude] = React.useState<string[]>([]);
  const [checking, setChecking] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [result, setResult] = React.useState<StatementImportResult>();
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const reset = () => {
    setFile(undefined);
    setPreview(undefined);
    setInclude([]);
    setInputKey((key) => key + 1);
  };

  const choose = async (selected: File | undefined) => {
    setError(undefined);
    setResult(undefined);
    setPreview(undefined);
    setInclude([]);
    setFile(undefined);
    if (!selected) return;
    if (selected.size > MAX_STATEMENT_PDF_BYTES) {
      setError('The statement PDF is larger than 5 MB.');
      return;
    }
    setChecking(true);
    try {
      const base64 = bytesToBase64(
        new Uint8Array(await selected.arrayBuffer()),
      );
      setPreview(await previewKcbStatement(base64));
      setFile({ name: selected.name, base64 });
    } catch (cause) {
      setError(errorMessage(cause, 'The statement could not be checked.'));
    } finally {
      setChecking(false);
    }
  };

  const rows = preview?.rows ?? [];
  const counts = statementOutcomeCounts(rows);
  const toImport = rows.filter(
    (row) =>
      row.outcome === 'new' ||
      (row.outcome === 'matched_check' &&
        row.receipt &&
        include.includes(row.receipt)),
  );
  const importTotal = toImport.reduce((sum, row) => sum + row.moneyIn, 0);
  const completed = preview?.importStatus === 'completed';
  const canImport =
    Boolean(file && preview) && !preview?.problems.length && !completed;

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Import a KCB statement</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Upload the KCB account statement PDF to bring older M-Pesa payments
          into this queue. Payments the app already has are skipped, and no
          member balance changes until you reconcile each payment.
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
              ? 'This statement was already imported'
              : 'Statement imported'
          }
          variant="success"
          role="status"
        >
          {result.duplicate
            ? 'Nothing changed.'
            : `${result.counts.imported ?? 0} payment(s) were added to the queue below; ${result.counts.already_in_app ?? 0} were already in the app and ${result.counts.matched_check ?? 0} were left for checking.`}
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
          <dl className="grid gap-2 rounded-md bg-gray-50 p-3 text-sm sm:grid-cols-4 dark:bg-gray-900">
            <div>
              <dt className="text-gray-500">Period</dt>
              <dd className="font-semibold">
                {preview.header.periodStart} to {preview.header.periodEnd}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Money in</dt>
              <dd className="font-semibold">
                {formatStatementAmount(preview.header.totalMoneyInCents / 100)}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">New payments</dt>
              <dd className="font-semibold">{counts.new}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Already in the app</dt>
              <dd className="font-semibold">{counts.already_in_app}</dd>
            </div>
          </dl>
          {completed ? (
            <Callout title="Already imported" variant="default">
              This statement was imported before. Importing it again changes
              nothing.
            </Callout>
          ) : null}
          {preview.importStatus === 'importing' ? (
            <Callout title="An earlier import did not finish" variant="warning">
              Importing again completes it without duplicating payments.
            </Callout>
          ) : null}
          {counts.matched_check ? (
            <Callout title="Some payments need a check" variant="warning">
              Their M-Pesa code is on a payment recorded earlier, but that
              payment does not clearly match. They are skipped unless you tick
              “Import anyway”.
            </Callout>
          ) : null}
          <TableRoot className="max-h-[28rem] overflow-y-auto">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Date</TableHeaderCell>
                  <TableHeaderCell>Payment</TableHeaderCell>
                  <TableHeaderCell>Payer</TableHeaderCell>
                  <TableHeaderCell className="text-right">
                    Amount
                  </TableHeaderCell>
                  <TableHeaderCell>Outcome</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => {
                  const matchedMembers = (row.matchedMemberIds ?? [])
                    .map((id) => memberNames.get(id) ?? id)
                    .join(', ');
                  return (
                    <TableRow key={row.index}>
                      <TableCell className="whitespace-nowrap">
                        {row.transactionDate}
                      </TableCell>
                      <TableCell>
                        {row.receipt ? (
                          <span className="font-mono font-semibold">
                            {row.receipt}
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
                        {row.outcome === 'matched_check' && row.receipt ? (
                          <span className="mt-2 flex items-center gap-2">
                            <Checkbox
                              id={`statement-include-${row.receipt}`}
                              checked={include.includes(row.receipt)}
                              disabled={completed}
                              onCheckedChange={(checked) =>
                                setInclude((current) =>
                                  checked === true
                                    ? [...current, row.receipt as string]
                                    : current.filter(
                                        (receipt) => receipt !== row.receipt,
                                      ),
                                )
                              }
                            />
                            <Label
                              htmlFor={`statement-include-${row.receipt}`}
                              className="text-xs"
                            >
                              Import anyway
                            </Label>
                          </span>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableRoot>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!canImport || !toImport.length}
              onClick={() => setConfirmOpen(true)}
            >
              Import {toImport.length} payment
              {toImport.length === 1 ? '' : 's'}
            </Button>
            <Button variant="secondary" onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {file && preview ? (
        <DialogKcbAction
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Import statement payments"
          description="The payments are added to the reconciliation queue as unresolved. No member balance changes until you reconcile them one by one."
          summary={[
            { label: 'File', value: file.name },
            {
              label: 'Period',
              value: `${preview.header.periodStart} to ${preview.header.periodEnd}`,
            },
            { label: 'Payments', value: String(toImport.length) },
            { label: 'Total', value: formatStatementAmount(importTotal) },
            ...(include.length
              ? [{ label: 'Checked anyway', value: String(include.length) }]
              : []),
          ]}
          confirmLabel="Import payments"
          loadingText="Importing"
          onConfirm={async () => {
            const imported = await importKcbStatement({
              pdfBase64: file.base64,
              fileName: file.name,
              includeReceipts: include,
            });
            setResult(imported);
            reset();
          }}
        />
      ) : null}
    </Card>
  );
};
