import { describe, expect, it } from 'vitest';
import { parseKcbStatement, validateKcbStatement } from 'tmbwa-shared';
import {
  MAX_STATEMENT_PDF_BYTES,
  referenceMatch,
  statementPdfBytes,
  statementTransactionDate,
} from '../functions/src/kcb/statement/domain';
import { extractPdfText } from '../functions/src/kcb/statement/pdf';
import { statementPdf } from './fixtures/kcbStatementPdf';

const payment = (path: string, memberId: string, amount: number, memberPhone = '+254700000001') =>
  ({ path, memberId, amount, memberPhone });

describe('referenceMatch', () => {
  const row = { amount: 3000, payerPhone: '+254700000001' };

  it('finds nothing when no payment carries the code', () => {
    expect(referenceMatch(row, [])).toEqual({ kind: 'none' });
  });

  it('treats one member\'s payments totalling the statement amount as already recorded', () => {
    expect(referenceMatch(row, [payment('members/a/payments/1', 'a', 3000)]))
      .toEqual({ kind: 'recorded', memberId: 'a', paths: ['members/a/payments/1'] });
    // A lump sum recorded month by month under one code.
    expect(referenceMatch(row, [
      payment('members/a/payments/1', 'a', 1000),
      payment('members/a/payments/2', 'a', 1000),
      payment('members/a/payments/3', 'a', 1000),
    ])).toMatchObject({ kind: 'recorded', memberId: 'a' });
    expect(referenceMatch({ amount: 500.5, payerPhone: row.payerPhone }, [
      payment('members/a/payments/1', 'a', 500.25),
      payment('members/a/payments/2', 'a', 0.25),
    ])).toMatchObject({ kind: 'recorded' });
  });

  it('asks for a check when the payments do not clearly account for it', () => {
    expect(referenceMatch(row, [payment('members/a/payments/1', 'a', 2500)]))
      .toMatchObject({ kind: 'check', reason: 'amount_differs', memberIds: ['a'] });
    expect(referenceMatch(row, [
      payment('members/a/payments/1', 'a', 1500),
      payment('members/b/payments/2', 'b', 1500),
    ])).toMatchObject({ kind: 'check', reason: 'several_members', memberIds: ['a', 'b'] });
    expect(referenceMatch(row, [payment('members/a/payments/1', 'a', 3000, '+254700000009')]))
      .toMatchObject({ kind: 'check', reason: 'payer_phone_differs' });
    expect(referenceMatch({ amount: 3000 }, [payment('members/a/payments/1', 'a', 3000)]))
      .toMatchObject({ kind: 'check', reason: 'payer_phone_differs' });
  });
});

describe('statementTransactionDate', () => {
  it('dates a statement day at midnight in the STK transaction date form', () => {
    expect(statementTransactionDate('2025-04-01')).toBe('20250401000000');
    expect(() => statementTransactionDate('01.04.2025')).toThrow();
  });
});

describe('statementPdfBytes', () => {
  it('accepts a base64 PDF', () => {
    const bytes = Buffer.from('%PDF-1.4 body');
    expect(statementPdfBytes(bytes.toString('base64'))).toEqual(bytes);
  });

  it('refuses anything else', () => {
    expect(() => statementPdfBytes(undefined)).toThrow(/required/);
    expect(() => statementPdfBytes('not base64!')).toThrow(/base64/);
    expect(() => statementPdfBytes(Buffer.from('PK zip file').toString('base64'))).toThrow(/not a PDF/);
    const large = Buffer.alloc(MAX_STATEMENT_PDF_BYTES + 1);
    large.write('%PDF-');
    expect(() => statementPdfBytes(large.toString('base64'))).toThrow(/5 MB/);
  });
});

describe('extractPdfText', () => {
  it('reads a statement PDF in the order parseKcbStatement expects', async () => {
    const pdf = statementPdf(
      {
        account: '1100000001', period: '01.04.2025 - 01.05.2025',
        start: '1,000.00', end: '2,500.00', moneyIn: '1,500.00', moneyOut: '0.00',
      },
      [
        { date: '01.04.2025', details: ['BALANCE B/FWD'], out: '0.00', in: '0.00', balance: '1,000.00' },
        {
          date: '02.04.2025', details: ['Transfer 7969138 MPESA', 'TD11AAAAAA 254700000001 JANE /'],
          out: '0.00', in: '1,000.00', balance: '2,000.00', reference: 'FT25092AAAA1',
        },
        {
          date: '03.04.2025', details: ['Mobi 522522 MPESA TD22BBBBBB', '254100000002 Jo (B) /'],
          out: '0.00', in: '500.00', balance: '2,500.00', reference: 'FT25093BBBB2',
        },
      ],
    );
    const statement = parseKcbStatement(await extractPdfText(pdf));
    expect(validateKcbStatement(statement, { expectedAccountNumber: '1100000001' })).toEqual([]);
    expect(statement.transactions.map((transaction) => transaction.mpesa?.receipt))
      .toEqual([undefined, 'TD11AAAAAA', 'TD22BBBBBB']);
    expect(statement.transactions[2].mpesa?.payerName).toBe('Jo (B)');
  });

  it('fails on a corrupt PDF', async () => {
    await expect(extractPdfText(Buffer.from('%PDF-1.4 not really'))).rejects.toThrow();
  });
});
