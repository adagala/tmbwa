// Helpers for importing KCB account statements on the reconciliation page
// (#94). The server parses and checks the PDF; these only present its answer.

export type StatementRowOutcome =
  | 'new'
  | 'already_in_app'
  | 'matched_check'
  | 'ignored';

export type StatementPreviewRow = {
  index: number;
  transactionDate: string;
  details: string;
  moneyIn: number;
  moneyOut: number;
  bankReference?: string;
  receipt?: string;
  channel?: 'till' | 'paybill';
  payerPhone?: string;
  payerName?: string;
  outcome: StatementRowOutcome;
  reason?: string;
  notificationId?: string;
  matchedPaymentPaths?: string[];
  matchedMemberIds?: string[];
  suggestedMemberId?: string;
};

export type StatementPreview = {
  importId: string;
  importStatus: 'importing' | 'completed' | null;
  header: {
    accountNumber: string;
    periodStart: string;
    periodEnd: string;
    openingBalanceCents: number;
    closingBalanceCents: number;
    totalMoneyInCents: number;
    totalMoneyOutCents: number;
    transactionCount: number;
  };
  problems: Array<{ code: string; message: string; index?: number }>;
  rows: StatementPreviewRow[];
};

export type StatementImportResult = {
  importId: string;
  duplicate: boolean;
  counts: Record<string, number>;
};

export const MAX_STATEMENT_PDF_BYTES = 5 * 1024 * 1024;

// Base64 for the callable payload, built in chunks so large files do not
// overflow the argument list of String.fromCharCode.
export const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
};

export const statementOutcomeLabel = (row: StatementPreviewRow) => {
  if (row.outcome === 'new') return 'Will be imported';
  if (row.outcome === 'ignored') {
    return row.reason === 'opening_balance'
      ? 'Opening balance'
      : 'Not an M-Pesa payment';
  }
  if (row.outcome === 'already_in_app') {
    if (row.reason === 'imported_earlier') return 'Imported earlier';
    return row.reason === 'recorded_payment'
      ? 'Already recorded by M-Pesa code'
      : 'Already received from KCB';
  }
  if (row.reason === 'several_members')
    return 'Check: code on several members’ payments';
  if (row.reason === 'amount_differs')
    return 'Check: code on a payment of another amount';
  return 'Check: code on another member’s payment';
};

export const statementOutcomeVariant = (
  outcome: StatementRowOutcome,
): 'success' | 'neutral' | 'warning' =>
  outcome === 'new'
    ? 'success'
    : outcome === 'matched_check'
      ? 'warning'
      : 'neutral';

export const statementOutcomeCounts = (rows: StatementPreviewRow[]) =>
  rows.reduce<Record<StatementRowOutcome, number>>(
    (counts, row) => ({ ...counts, [row.outcome]: counts[row.outcome] + 1 }),
    { new: 0, already_in_app: 0, matched_check: 0, ignored: 0 },
  );

export const formatStatementAmount = (amount: number) =>
  `KES ${amount.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export type RecordedPaymentOption = {
  id: string;
  amount: number;
  reference: string;
  paidOn?: Date;
};

// Existing payments a statement payment might duplicate, closest in date
// first, within half a year either side of the statement date.
export const alreadyRecordedCandidates = (
  payments: RecordedPaymentOption[],
  paidOn: Date | undefined,
  windowDays = 183,
) => {
  if (!paidOn) return [...payments];
  const distance = (payment: RecordedPaymentOption) =>
    payment.paidOn
      ? Math.abs(payment.paidOn.getTime() - paidOn.getTime())
      : Number.POSITIVE_INFINITY;
  return payments
    .filter((payment) => distance(payment) <= windowDays * 86_400_000)
    .sort((left, right) => distance(left) - distance(right));
};
