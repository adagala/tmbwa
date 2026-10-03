import { normalizeMpesaReference, type KcbStatementTransaction } from 'tmbwa-shared';

// Decisions for importing KCB account statements (#94), kept free of
// Firestore so they can be unit-tested.

export const MAX_STATEMENT_PDF_BYTES = 5 * 1024 * 1024;

export type StatementRowOutcome =
  // Imported as an unresolved notification for reconciliation.
  | 'new'
  // Already a KCB notification, or a payment carrying the same M-Pesa code.
  | 'already_in_app'
  // A payment carries the code but does not clearly account for it; imported
  // only when the treasurer selects it.
  | 'matched_check'
  // Not an M-Pesa credit.
  | 'ignored';

export type ReferencePayment = {
  path: string;
  memberId: string;
  amount: number;
  // The member's `phoneNormalized`.
  memberPhone?: string;
};

export type ReferenceMatch =
  | { kind: 'none' }
  | { kind: 'recorded'; memberId: string; paths: string[] }
  | {
      kind: 'check';
      reason: 'several_members' | 'amount_differs' | 'payer_phone_differs';
      memberIds: string[];
      paths: string[];
    };

// Whether payments recorded by hand with the statement's M-Pesa code already
// account for it. A lump sum is often recorded as several payments with the
// same code, so their total is compared with the statement amount.
export const referenceMatch = (
  row: { amount: number; payerPhone?: string },
  payments: ReferencePayment[],
): ReferenceMatch => {
  if (!payments.length) return { kind: 'none' };
  const memberIds = [...new Set(payments.map((payment) => payment.memberId))];
  const paths = payments.map((payment) => payment.path);
  if (memberIds.length > 1) return { kind: 'check', reason: 'several_members', memberIds, paths };
  const totalCents = payments.reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0);
  if (totalCents !== Math.round(row.amount * 100)) {
    return { kind: 'check', reason: 'amount_differs', memberIds, paths };
  }
  if (!row.payerPhone || payments[0].memberPhone !== row.payerPhone) {
    return { kind: 'check', reason: 'payer_phone_differs', memberIds, paths };
  }
  return { kind: 'recorded', memberId: memberIds[0], paths };
};

// Statements give a date without a time. Stored in the STK transaction date
// form at midnight in Nairobi, so reconciliation can date the payment.
export const statementTransactionDate = (isoDate: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error(`Invalid statement date: ${isoDate}`);
  return `${isoDate.replace(/-/g, '')}000000`;
};

export const statementAmount = (transaction: Pick<KcbStatementTransaction, 'moneyInCents'>) =>
  transaction.moneyInCents / 100;

// The decoded upload, refused unless it is a PDF of a sensible size.
export const statementPdfBytes = (value: unknown) => {
  if (typeof value !== 'string' || !value) throw new Error('pdfBase64 is required.');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('pdfBase64 is not valid base64.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > MAX_STATEMENT_PDF_BYTES) throw new Error('The statement PDF is larger than 5 MB.');
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('The file is not a PDF.');
  return bytes;
};

export const MAX_SELECTED_RECEIPTS = 1000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isoDateValue = (value: unknown, name: string) => {
  if (value === undefined || value === null || value === '') return undefined;
  // Round-tripping rejects dates that do not exist, such as 2025-06-31.
  const date = typeof value === 'string' && ISO_DATE.test(value) ? new Date(`${value}T00:00:00Z`) : undefined;
  const valid = date !== undefined && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  if (!valid) {
    throw new Error(`${name} must be a date in the form YYYY-MM-DD.`);
  }
  return value;
};

// The payments the treasurer chose to import, checked against the uploaded
// statement: each must be one of its M-Pesa credits and, when a date range is
// given, dated within it.
export const importSelection = (
  transactions: KcbStatementTransaction[],
  input: { receipts: unknown; fromDate?: unknown; toDate?: unknown },
) => {
  const { receipts } = input;
  if (!Array.isArray(receipts) || !receipts.length) {
    throw new Error('Choose at least one payment to import.');
  }
  if (receipts.length > MAX_SELECTED_RECEIPTS) {
    throw new Error(`Import at most ${MAX_SELECTED_RECEIPTS} payments at a time.`);
  }
  const selected = new Set(receipts.map((receipt) => {
    const normalized = normalizeMpesaReference(receipt);
    if (!normalized) throw new Error('receipts must be M-Pesa receipts.');
    return normalized;
  }));
  const fromDate = isoDateValue(input.fromDate, 'fromDate');
  const toDate = isoDateValue(input.toDate, 'toDate');
  if (fromDate && toDate && fromDate > toDate) throw new Error('fromDate must not be after toDate.');

  const credits = new Map(transactions.flatMap((transaction) => {
    const receipt = transaction.mpesa && normalizeMpesaReference(transaction.mpesa.receipt);
    return transaction.kind === 'mpesa_credit' && receipt ? [[receipt, transaction] as const] : [];
  }));
  selected.forEach((receipt) => {
    const transaction = credits.get(receipt);
    if (!transaction) throw new Error(`${receipt} is not an M-Pesa payment in this statement.`);
    if ((fromDate && transaction.transactionDate < fromDate) || (toDate && transaction.transactionDate > toDate)) {
      throw new Error(`${receipt} is outside the chosen date range.`);
    }
  });
  return {
    receipts: selected,
    ...(fromDate ? { fromDate } : {}),
    ...(toDate ? { toDate } : {}),
  };
};
