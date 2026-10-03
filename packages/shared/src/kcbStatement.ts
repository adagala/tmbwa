// ---------------------------------------------------------------------------
// KCB account statements (#94)
// ---------------------------------------------------------------------------
//
// Parses the text of the KCB "Account Statement" PDF so historical M-Pesa
// credits can be imported. The input is the PDF's text in content order with
// any whitespace between items, e.g. pdf.js text items joined with spaces. The
// parser is strict: text it does not recognise, other than page numbers,
// fails the parse rather than being skipped, and validateKcbStatement checks
// the rows against the statement's own totals and running balance, so a
// payment cannot be silently dropped.
//
// Amounts are integer cents to keep the balance arithmetic exact.

export type KcbStatementHeader = {
  accountNumber: string;
  accountName: string;
  // YYYY-MM-DD
  periodStart: string;
  periodEnd: string;
  openingBalanceCents: number;
  closingBalanceCents: number;
  totalMoneyInCents: number;
  totalMoneyOutCents: number;
};

export type KcbStatementMpesaCredit = {
  // `Transfer <till>` or `Mobi <paybill>`
  channel: 'till' | 'paybill';
  businessNumber: string;
  receipt: string;
  // As printed, e.g. 254712345678
  payerPhone: string;
  // KCB truncates payer names, usually to four characters.
  payerName: string;
};

export type KcbStatementTransaction = {
  // Position among the statement's transactions, from 0.
  index: number;
  // YYYY-MM-DD
  transactionDate: string;
  valueDate: string;
  details: string;
  moneyOutCents: number;
  moneyInCents: number;
  ledgerBalanceCents: number;
  bankReference?: string;
  kind: 'opening_balance' | 'mpesa_credit' | 'other';
  mpesa?: KcbStatementMpesaCredit;
};

export type KcbStatement = {
  header: KcbStatementHeader;
  transactions: KcbStatementTransaction[];
};

export class KcbStatementParseError extends Error {
  constructor(readonly code: 'not_a_kcb_statement' | 'invalid_header' | 'unrecognised_text', message: string) {
    super(message);
    this.name = 'KcbStatementParseError';
  }
}

const AMOUNT = String.raw`\d{1,3}(?:,\d{3})*\.\d{2}`;
const DATE = String.raw`\d{2}\.\d{2}\.\d{4}`;

const COLUMNS = /Transaction Date Value Date Transaction Details Money Out Money In Ledger Balance Bank Reference Number/;

const HEADER_LABELS = [
  'Account Statement',
  'Date:',
  'Account:',
  'Account Name:',
  'Available Balance:',
  'Period:',
  'Balance At Period Start:',
  'Balance At Period End:',
  'Total Money In:',
  'Total Money Out:',
];

const ROW = new RegExp(
  String.raw`(${DATE}) (${DATE}) (.*?) ?(${AMOUNT}) (${AMOUNT}) (${AMOUNT})(?: (FT[A-Z0-9]+))?(?= |$)`,
  'g',
);

const MPESA_DETAILS = /^(Transfer|Mobi) (\d+) MPESA ([A-Z0-9]{8,20}) (254\d{9}) ?(.*?) ?\/$/;

export const parseStatementAmountCents = (value: string) => {
  if (!new RegExp(`^${AMOUNT}$`).test(value)) throw new Error(`Invalid amount: ${value}`);
  const [whole, cents] = value.replace(/,/g, '').split('.');
  return Number(whole) * 100 + Number(cents);
};

const isoDate = (value: string) => {
  const [day, month, year] = value.split('.');
  return `${year}-${month}-${day}`;
};

const headerValue = (header: string, label: string) => {
  const start = header.indexOf(label);
  if (start < 0) throw new KcbStatementParseError('invalid_header', `Statement header is missing "${label}".`);
  const rest = header.slice(start + label.length);
  const ends = HEADER_LABELS
    .map((next) => rest.indexOf(` ${next}`))
    .filter((index) => index >= 0);
  return rest.slice(0, ends.length ? Math.min(...ends) : undefined).trim();
};

const headerAmount = (header: string, label: string) => {
  const value = headerValue(header, label).replace(/^KES /, '');
  try {
    return parseStatementAmountCents(value);
  } catch {
    throw new KcbStatementParseError('invalid_header', `Statement header "${label}" is not an amount.`);
  }
};

const parseHeader = (header: string): KcbStatementHeader => {
  const period = headerValue(header, 'Period:').match(new RegExp(`^(${DATE}) - (${DATE})$`));
  const accountNumber = headerValue(header, 'Account:');
  if (!period) throw new KcbStatementParseError('invalid_header', 'Statement period is not recognised.');
  if (!/^\d+$/.test(accountNumber)) {
    throw new KcbStatementParseError('invalid_header', 'Statement account number is not recognised.');
  }
  return {
    accountNumber,
    accountName: headerValue(header, 'Account Name:'),
    periodStart: isoDate(period[1]),
    periodEnd: isoDate(period[2]),
    openingBalanceCents: headerAmount(header, 'Balance At Period Start:'),
    closingBalanceCents: headerAmount(header, 'Balance At Period End:'),
    totalMoneyInCents: headerAmount(header, 'Total Money In:'),
    totalMoneyOutCents: headerAmount(header, 'Total Money Out:'),
  };
};

const mpesaCredit = (details: string): KcbStatementMpesaCredit | undefined => {
  const match = details.match(MPESA_DETAILS);
  if (!match) return undefined;
  return {
    channel: match[1] === 'Transfer' ? 'till' : 'paybill',
    businessNumber: match[2],
    receipt: match[3],
    payerPhone: match[4],
    payerName: match[5],
  };
};

// Page numbers are the only text allowed between and around rows.
const isPageNumbers = (text: string) => /^(?:\d{1,4}(?: \d{1,4})*)?$/.test(text.trim());

export const parseKcbStatement = (text: string): KcbStatement => {
  const flat = text.replace(/\s+/g, ' ').trim();
  const columns = flat.match(COLUMNS);
  if (!columns || columns.index === undefined || !flat.includes('Account Statement')) {
    throw new KcbStatementParseError('not_a_kcb_statement', 'This is not a KCB account statement.');
  }
  const preamble = flat.slice(0, columns.index);
  const headerStart = preamble.indexOf('Account Statement');
  if (!isPageNumbers(preamble.slice(0, headerStart))) {
    throw new KcbStatementParseError('unrecognised_text', 'Unrecognised text before the statement header.');
  }
  const header = parseHeader(preamble.slice(headerStart));
  const body = flat.slice(columns.index + columns[0].length);

  const transactions: KcbStatementTransaction[] = [];
  let cursor = 0;
  for (const match of body.matchAll(ROW)) {
    const gap = body.slice(cursor, match.index);
    if (!isPageNumbers(gap)) {
      throw new KcbStatementParseError(
        'unrecognised_text',
        `Unrecognised text before transaction ${transactions.length + 1}.`,
      );
    }
    const details = match[3].trim();
    const moneyOutCents = parseStatementAmountCents(match[4]);
    const moneyInCents = parseStatementAmountCents(match[5]);
    const mpesa = moneyOutCents === 0 && moneyInCents > 0 ? mpesaCredit(details) : undefined;
    transactions.push({
      index: transactions.length,
      transactionDate: isoDate(match[1]),
      valueDate: isoDate(match[2]),
      details,
      moneyOutCents,
      moneyInCents,
      ledgerBalanceCents: parseStatementAmountCents(match[6]),
      ...(match[7] ? { bankReference: match[7] } : {}),
      kind: details === 'BALANCE B/FWD' ? 'opening_balance' : mpesa ? 'mpesa_credit' : 'other',
      ...(mpesa ? { mpesa } : {}),
    });
    cursor = (match.index ?? 0) + match[0].length;
  }
  if (!isPageNumbers(body.slice(cursor))) {
    throw new KcbStatementParseError('unrecognised_text', 'Unrecognised text after the last transaction.');
  }
  return { header, transactions };
};

export type KcbStatementProblem = {
  code:
    | 'account_mismatch'
    | 'no_transactions'
    | 'opening_balance_mismatch'
    | 'balance_discontinuity'
    | 'closing_balance_mismatch'
    | 'money_in_total_mismatch'
    | 'money_out_total_mismatch'
    | 'date_outside_period'
    | 'duplicate_bank_reference'
    | 'duplicate_receipt';
  message: string;
  // The transaction the problem was found at.
  index?: number;
};

// Checks a parsed statement against its own header and, when given, the
// association's account number. An empty result means every row was read and
// every shilling is accounted for.
export const validateKcbStatement = (
  statement: KcbStatement,
  options: { expectedAccountNumber?: string } = {},
): KcbStatementProblem[] => {
  const { header, transactions } = statement;
  const problems: KcbStatementProblem[] = [];
  if (options.expectedAccountNumber !== undefined && header.accountNumber !== options.expectedAccountNumber) {
    problems.push({ code: 'account_mismatch', message: 'The statement is for a different account.' });
  }
  if (!transactions.length) {
    problems.push({ code: 'no_transactions', message: 'The statement has no transactions.' });
    return problems;
  }

  let balance = header.openingBalanceCents;
  let moneyIn = 0;
  let moneyOut = 0;
  transactions.forEach((transaction) => {
    if (transaction.kind === 'opening_balance') {
      if (transaction.ledgerBalanceCents !== header.openingBalanceCents) {
        problems.push({
          code: 'opening_balance_mismatch',
          message: 'The brought-forward balance does not match the period start balance.',
          index: transaction.index,
        });
      }
    }
    balance += transaction.moneyInCents - transaction.moneyOutCents;
    moneyIn += transaction.moneyInCents;
    moneyOut += transaction.moneyOutCents;
    if (balance !== transaction.ledgerBalanceCents) {
      problems.push({
        code: 'balance_discontinuity',
        message: `The running balance does not follow at transaction ${transaction.index + 1}.`,
        index: transaction.index,
      });
      balance = transaction.ledgerBalanceCents;
    }
    if (transaction.transactionDate < header.periodStart || transaction.transactionDate > header.periodEnd) {
      problems.push({
        code: 'date_outside_period',
        message: `Transaction ${transaction.index + 1} is dated outside the statement period.`,
        index: transaction.index,
      });
    }
  });
  if (transactions[transactions.length - 1].ledgerBalanceCents !== header.closingBalanceCents) {
    problems.push({ code: 'closing_balance_mismatch', message: 'The final balance does not match the period end balance.' });
  }
  if (moneyIn !== header.totalMoneyInCents) {
    problems.push({ code: 'money_in_total_mismatch', message: 'The credits do not add up to Total Money In.' });
  }
  if (moneyOut !== header.totalMoneyOutCents) {
    problems.push({ code: 'money_out_total_mismatch', message: 'The debits do not add up to Total Money Out.' });
  }

  const seen = { bankReference: new Set<string>(), receipt: new Set<string>() };
  transactions.forEach((transaction) => {
    if (transaction.bankReference) {
      if (seen.bankReference.has(transaction.bankReference)) {
        problems.push({
          code: 'duplicate_bank_reference',
          message: `Bank reference at transaction ${transaction.index + 1} appears more than once.`,
          index: transaction.index,
        });
      }
      seen.bankReference.add(transaction.bankReference);
    }
    if (transaction.mpesa) {
      if (seen.receipt.has(transaction.mpesa.receipt)) {
        problems.push({
          code: 'duplicate_receipt',
          message: `M-Pesa receipt at transaction ${transaction.index + 1} appears more than once.`,
          index: transaction.index,
        });
      }
      seen.receipt.add(transaction.mpesa.receipt);
    }
  });
  return problems;
};
