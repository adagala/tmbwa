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
  runId: string;
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
  if (row.outcome === 'new') return 'New';
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

// Rows the treasurer can choose to import: new payments, and payments whose
// M-Pesa code is on a recorded payment that does not clearly match.
export const isSelectableRow = (row: StatementPreviewRow) =>
  Boolean(row.receipt) &&
  (row.outcome === 'new' || row.outcome === 'matched_check');

// Statement dates are YYYY-MM-DD; the date picker works with local dates.
export const isoDate = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');

export const localDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export type IsoDateRange = { from?: string; to?: string };

export const rowsInRange = <Row extends { transactionDate: string }>(
  rows: Row[],
  range: IsoDateRange,
) =>
  rows.filter(
    (row) =>
      (!range.from || row.transactionDate >= range.from) &&
      (!range.to || row.transactionDate <= range.to),
  );

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// The whole statement, then each calendar month it covers, clipped to the
// statement period.
export const statementRangePresets = (
  periodStart: string,
  periodEnd: string,
) => {
  const presets: Array<{ label: string; from: string; to: string }> = [
    { label: 'Whole statement', from: periodStart, to: periodEnd },
  ];
  const [endYear, endMonth] = periodEnd.split('-').map(Number);
  let [year, month] = periodStart.split('-').map(Number);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const first = `${year}-${String(month).padStart(2, '0')}-01`;
    const last = isoDate(new Date(year, month, 0));
    presets.push({
      label: `${MONTH_NAMES[month - 1]} ${year}`,
      from: first < periodStart ? periodStart : first,
      to: last > periodEnd ? periodEnd : last,
    });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return presets;
};
