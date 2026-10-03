import { describe, expect, it } from 'vitest';
import {
  StatementPreviewRow,
  alreadyRecordedCandidates,
  bytesToBase64,
  formatStatementAmount,
  isSelectableRow,
  isoDate,
  localDate,
  rowsInRange,
  statementOutcomeCounts,
  statementRangePresets,
  statementOutcomeLabel,
  statementOutcomeVariant,
} from '../src/lib/kcbStatementImport';

const row = (overrides: Partial<StatementPreviewRow>): StatementPreviewRow => ({
  index: 0,
  transactionDate: '2025-04-02',
  details: '',
  moneyIn: 500,
  moneyOut: 0,
  outcome: 'new',
  ...overrides,
});

describe('bytesToBase64', () => {
  it('encodes bytes the way the server decodes them', () => {
    const bytes = new Uint8Array(70_000).map((_, index) => index % 256);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    expect(bytesToBase64(new Uint8Array())).toBe('');
  });
});

describe('statement preview outcomes', () => {
  it('labels every outcome for the treasurer', () => {
    expect(statementOutcomeLabel(row({}))).toBe('New');
    expect(statementOutcomeLabel(row({ outcome: 'ignored', reason: 'opening_balance' }))).toBe('Opening balance');
    expect(statementOutcomeLabel(row({ outcome: 'ignored', reason: 'not_mpesa_credit' }))).toBe('Not an M-Pesa payment');
    expect(statementOutcomeLabel(row({ outcome: 'already_in_app', reason: 'kcb_notification' })))
      .toBe('Already received from KCB');
    expect(statementOutcomeLabel(row({ outcome: 'already_in_app', reason: 'recorded_payment' })))
      .toBe('Already recorded by M-Pesa code');
    expect(statementOutcomeLabel(row({ outcome: 'already_in_app', reason: 'imported_earlier' })))
      .toBe('Imported earlier');
    expect(statementOutcomeLabel(row({ outcome: 'matched_check', reason: 'amount_differs' })))
      .toBe('Check: code on a payment of another amount');
    expect(statementOutcomeLabel(row({ outcome: 'matched_check', reason: 'several_members' })))
      .toBe('Check: code on several members’ payments');
    expect(statementOutcomeLabel(row({ outcome: 'matched_check', reason: 'payer_phone_differs' })))
      .toBe('Check: code on another member’s payment');
  });

  it('highlights new payments and payments needing a check', () => {
    expect(statementOutcomeVariant('new')).toBe('success');
    expect(statementOutcomeVariant('matched_check')).toBe('warning');
    expect(statementOutcomeVariant('already_in_app')).toBe('neutral');
    expect(statementOutcomeVariant('ignored')).toBe('neutral');
  });

  it('counts rows by outcome', () => {
    expect(statementOutcomeCounts([
      row({}), row({}), row({ outcome: 'ignored' }), row({ outcome: 'matched_check' }),
    ])).toEqual({ new: 2, already_in_app: 0, matched_check: 1, ignored: 1 });
  });

  it('formats shillings with cents only when present', () => {
    expect(formatStatementAmount(1500)).toBe('KES 1,500');
    expect(formatStatementAmount(500.5)).toBe('KES 500.5');
  });
});

describe('alreadyRecordedCandidates', () => {
  const on = (date: string) => new Date(`${date}T00:00:00+03:00`);
  const payments = [
    { id: 'far', amount: 500, reference: 'cash', paidOn: on('2024-01-01') },
    { id: 'later', amount: 500, reference: 'cash', paidOn: on('2025-04-20') },
    { id: 'near', amount: 500, reference: 'cash', paidOn: on('2025-04-03') },
    { id: 'undated', amount: 500, reference: 'cash' },
  ];

  it('lists payments within half a year, closest first', () => {
    expect(alreadyRecordedCandidates(payments, on('2025-04-02')).map((item) => item.id))
      .toEqual(['near', 'later']);
  });

  it('lists everything when the statement payment has no date', () => {
    expect(alreadyRecordedCandidates(payments, undefined)).toHaveLength(4);
  });
});

describe('choosing rows to import', () => {
  it('lets only new rows and rows needing a check be selected', () => {
    expect(isSelectableRow(row({ receipt: 'TD11AAAAAA' }))).toBe(true);
    expect(isSelectableRow(row({ receipt: 'TD11AAAAAA', outcome: 'matched_check' }))).toBe(true);
    expect(isSelectableRow(row({ receipt: 'TD11AAAAAA', outcome: 'already_in_app' }))).toBe(false);
    expect(isSelectableRow(row({ outcome: 'ignored' }))).toBe(false);
    expect(isSelectableRow(row({}))).toBe(false);
  });

  it('filters rows by an inclusive date range, open at either end', () => {
    const rows = ['2025-05-31', '2025-06-01', '2025-06-30', '2025-07-01'].map((transactionDate) =>
      row({ transactionDate }));
    const dates = (range: { from?: string; to?: string }) =>
      rowsInRange(rows, range).map((item) => item.transactionDate);
    expect(dates({ from: '2025-06-01', to: '2025-06-30' })).toEqual(['2025-06-01', '2025-06-30']);
    expect(dates({ from: '2025-06-30' })).toEqual(['2025-06-30', '2025-07-01']);
    expect(dates({ to: '2025-05-31' })).toEqual(['2025-05-31']);
    expect(dates({})).toHaveLength(4);
  });

  it('converts between statement dates and the picker’s local dates', () => {
    expect(isoDate(new Date(2025, 5, 1))).toBe('2025-06-01');
    expect(localDate('2025-06-30').getDate()).toBe(30);
    expect(isoDate(localDate('2025-12-31'))).toBe('2025-12-31');
  });

  it('offers the whole statement and each month it covers, clipped to the period', () => {
    expect(statementRangePresets('2025-04-15', '2025-07-10')).toEqual([
      { label: 'Whole statement', from: '2025-04-15', to: '2025-07-10' },
      { label: 'April 2025', from: '2025-04-15', to: '2025-04-30' },
      { label: 'May 2025', from: '2025-05-01', to: '2025-05-31' },
      { label: 'June 2025', from: '2025-06-01', to: '2025-06-30' },
      { label: 'July 2025', from: '2025-07-01', to: '2025-07-10' },
    ]);
    expect(statementRangePresets('2024-12-01', '2025-01-31').map((preset) => preset.label))
      .toEqual(['Whole statement', 'December 2024', 'January 2025']);
    expect(statementRangePresets('2024-02-01', '2024-02-29')[1]).toEqual(
      { label: 'February 2024', from: '2024-02-01', to: '2024-02-29' });
  });
});
