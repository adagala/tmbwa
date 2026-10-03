import { describe, expect, it } from 'vitest';
import {
  KcbStatementParseError,
  parseKcbStatement,
  parseStatementAmountCents,
  validateKcbStatement,
} from 'tmbwa-shared';

// Synthetic statements in the layout of the KCB "Account Statement" PDF as
// pdf.js extracts it: one text item per cell, M-Pesa details split over two
// items, and a page number between pages. No real member data.

type Row = {
  date: string;
  details: string[];
  out: string;
  in: string;
  balance: string;
  reference?: string;
};

const header = (overrides: Partial<Record<string, string>> = {}) => {
  const value = {
    account: '1100000001',
    name: 'SAMPLE WELFARE ASSOCIATION',
    period: '01.04.2025 - 01.05.2025',
    start: '1,000.00',
    end: '5,500.00',
    moneyIn: '5,000.00',
    moneyOut: '500.00',
    ...overrides,
  };
  return [
    '1', '', 'Account Statement', '', 'Date: 03/10/2026 11:54:48', '',
    `Account: ${value.account}`,
    `Account Name: ${value.name}`,
    'Available Balance: KES 9,999,999.99',
    `Period: ${value.period}`,
    `Balance At Period Start: ${value.start}`,
    `Balance At Period End: ${value.end}`,
    `Total Money In: ${value.moneyIn}`,
    `Total Money Out: ${value.moneyOut}`,
    '', 'Transaction', 'Date', ' ', 'Value Date', ' ', 'Transaction Details', ' ', 'Money Out', ' ',
    'Money In', ' ', 'Ledger Balance', ' ', 'Bank', 'Reference', 'Number',
  ];
};

const rowItems = (row: Row) => [
  row.date, ' ', row.date, ' ', ...row.details, ' ', row.out, ' ', row.in, ' ', row.balance,
  ...(row.reference ? [' ', row.reference] : []),
];

const ROWS: Row[] = [
  { date: '01.04.2025', details: ['BALANCE B/FWD'], out: '0.00', in: '0.00', balance: '1,000.00' },
  {
    date: '01.04.2025',
    details: ['Transfer 7969138 MPESA', 'TD11AAAAAA 254700000001 JANE /'],
    out: '0.00', in: '3,000.00', balance: '4,000.00', reference: 'FT25091AAAA1',
  },
  {
    date: '02.04.2025',
    details: ['Mobi 522522 MPESA TD22BBBBBB', '254100000002 Jo /'],
    out: '0.00', in: '1,500.00', balance: '5,500.00', reference: 'FT25092BBBB2',
  },
  {
    date: '03.04.2025',
    details: ['Excise Duty On Charges'],
    out: '500.00', in: '0.00', balance: '5,000.00', reference: 'FT25093CCCC3',
  },
  {
    date: '04.04.2025',
    details: ['Transfer 7969138 MPESA', 'TD44DDDDDD 254700000004 MARY /'],
    out: '0.00', in: '500.50', balance: '5,500.50', reference: 'FT25094DDDD4',
  },
];

// Money in is 5,000.50 with the 500.50 row; keep the header consistent.
const statementText = (rows: Row[] = ROWS, overrides: Partial<Record<string, string>> = {}) => [
  ...header({ end: '5,500.50', moneyIn: '5,000.50', ...overrides }),
  ...rowItems(rows[0]),
  ...rowItems(rows[1]),
  '', '', '2',
  ...rows.slice(2).flatMap(rowItems),
  '', '3',
].join(' ');

describe('parseStatementAmountCents', () => {
  it('parses statement amounts to integer cents', () => {
    expect(parseStatementAmountCents('0.00')).toBe(0);
    expect(parseStatementAmountCents('500.50')).toBe(50050);
    expect(parseStatementAmountCents('1,600,002.80')).toBe(160000280);
  });

  it('rejects anything that is not a statement amount', () => {
    for (const value of ['1,00.00', '500', '500.5', '-500.00', 'KES 500.00', '']) {
      expect(() => parseStatementAmountCents(value)).toThrow();
    }
  });
});

describe('parseKcbStatement', () => {
  it('reads the header', () => {
    expect(parseKcbStatement(statementText()).header).toEqual({
      accountNumber: '1100000001',
      accountName: 'SAMPLE WELFARE ASSOCIATION',
      periodStart: '2025-04-01',
      periodEnd: '2025-05-01',
      openingBalanceCents: 100000,
      closingBalanceCents: 550050,
      totalMoneyInCents: 500050,
      totalMoneyOutCents: 50000,
    });
  });

  it('reads every transaction across page breaks and split details', () => {
    const { transactions } = parseKcbStatement(statementText());
    expect(transactions.map((transaction) => transaction.kind))
      .toEqual(['opening_balance', 'mpesa_credit', 'mpesa_credit', 'other', 'mpesa_credit']);
    expect(transactions[0]).toEqual({
      index: 0,
      transactionDate: '2025-04-01',
      valueDate: '2025-04-01',
      details: 'BALANCE B/FWD',
      moneyOutCents: 0,
      moneyInCents: 0,
      ledgerBalanceCents: 100000,
      kind: 'opening_balance',
    });
    expect(transactions[1]).toMatchObject({
      index: 1,
      transactionDate: '2025-04-01',
      moneyInCents: 300000,
      ledgerBalanceCents: 400000,
      bankReference: 'FT25091AAAA1',
      mpesa: {
        channel: 'till', businessNumber: '7969138', receipt: 'TD11AAAAAA', payerPhone: '254700000001', payerName: 'JANE',
      },
    });
    expect(transactions[2].mpesa).toEqual({
      channel: 'paybill', businessNumber: '522522', receipt: 'TD22BBBBBB', payerPhone: '254100000002', payerName: 'Jo',
    });
    expect(transactions[3]).toMatchObject({ details: 'Excise Duty On Charges', moneyOutCents: 50000, kind: 'other' });
    expect(transactions[3]).not.toHaveProperty('mpesa');
    expect(transactions[4]).toMatchObject({ moneyInCents: 50050, transactionDate: '2025-04-04' });
  });

  it('does not treat a debit or a non-M-Pesa credit as an M-Pesa payment', () => {
    const rows: Row[] = [
      ROWS[0],
      {
        date: '02.04.2025', details: ['Transfer 7969138 MPESA TD11AAAAAA 254700000001 JANE /'],
        out: '100.00', in: '0.00', balance: '900.00', reference: 'FT25092EEEE5',
      },
      { date: '03.04.2025', details: ['Cash Deposit'], out: '0.00', in: '100.00', balance: '1,000.00', reference: 'FT25093FFFF6' },
    ];
    const { transactions } = parseKcbStatement(statementText(rows));
    expect(transactions.slice(1).map((transaction) => transaction.kind)).toEqual(['other', 'other']);
  });

  it('accepts text with any whitespace between items', () => {
    const text = statementText().replace(/ /g, '\n  ');
    expect(parseKcbStatement(text).transactions).toHaveLength(5);
  });

  it('refuses a document that is not a KCB statement', () => {
    expect(() => parseKcbStatement('Invoice 123 Total 500.00')).toThrow(KcbStatementParseError);
    expect(() => parseKcbStatement('')).toThrow(expect.objectContaining({ code: 'not_a_kcb_statement' }));
  });

  it('refuses a statement with a missing or malformed header', () => {
    const missing = statementText().replace('Total Money Out: 500.00', '');
    expect(() => parseKcbStatement(missing)).toThrow(/Total Money Out/);
    const period = statementText(ROWS, { period: 'April 2025' });
    expect(() => parseKcbStatement(period)).toThrow(/period/);
    const account = statementText(ROWS, { account: 'ABC' });
    expect(() => parseKcbStatement(account)).toThrow(/account number/);
  });

  it('refuses text it does not recognise rather than skipping it', () => {
    const between = statementText().replace('FT25092BBBB2', 'FT25092BBBB2 Subtotal carried forward');
    expect(() => parseKcbStatement(between)).toThrow(expect.objectContaining({ code: 'unrecognised_text' }));
    const trailing = `${statementText()} End of statement`;
    expect(() => parseKcbStatement(trailing)).toThrow(expect.objectContaining({ code: 'unrecognised_text' }));
    const leading = `Confidential ${statementText()}`;
    expect(() => parseKcbStatement(leading)).toThrow(expect.objectContaining({ code: 'unrecognised_text' }));
  });
});

describe('validateKcbStatement', () => {
  const codes = (text: string, options?: { expectedAccountNumber?: string }) =>
    validateKcbStatement(parseKcbStatement(text), options).map((problem) => problem.code);

  it('accepts a complete, consistent statement for the expected account', () => {
    expect(codes(statementText(), { expectedAccountNumber: '1100000001' })).toEqual([]);
  });

  it('refuses a statement for another account', () => {
    expect(codes(statementText(), { expectedAccountNumber: '1100000002' })).toEqual(['account_mismatch']);
  });

  it('detects an amount that does not follow the running balance', () => {
    const rows = ROWS.map((row) => (row.reference === 'FT25092BBBB2' ? { ...row, in: '1,400.00' } : row));
    expect(codes(statementText(rows))).toEqual(['balance_discontinuity', 'money_in_total_mismatch']);
  });

  it('detects a missing transaction', () => {
    const rows = ROWS.filter((row) => row.reference !== 'FT25093CCCC3');
    expect(codes(statementText(rows))).toEqual(['balance_discontinuity', 'money_out_total_mismatch']);
  });

  it('checks the opening and closing balances against the header', () => {
    expect(codes(statementText(ROWS, { start: '900.00' })))
      .toEqual(['opening_balance_mismatch', 'balance_discontinuity']);
    expect(codes(statementText(ROWS, { end: '5,600.00' }))).toEqual(['closing_balance_mismatch']);
  });

  it('detects transactions dated outside the period', () => {
    const rows = ROWS.map((row) => (row.reference === 'FT25094DDDD4' ? { ...row, date: '02.05.2025' } : row));
    expect(codes(statementText(rows))).toEqual(['date_outside_period']);
  });

  it('detects repeated bank references and M-Pesa receipts', () => {
    const rows = ROWS.map((row) => (row.reference === 'FT25094DDDD4' ?
      { ...row, reference: 'FT25091AAAA1', details: ['Transfer 7969138 MPESA TD11AAAAAA 254700000004 MARY /'] } :
      row));
    expect(codes(statementText(rows))).toEqual(['duplicate_bank_reference', 'duplicate_receipt']);
  });

  it('refuses a statement with no transactions', () => {
    expect(codes(header().join(' '))).toEqual(['no_transactions']);
  });
});
