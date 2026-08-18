import { describe, expect, it } from 'vitest';
import { contributionOptionsFromDocuments } from '../src/lib/kcbReconciliation';

describe('KCB reconciliation contribution options', () => {
  it('includes unpaid and partially paid contributions', () => {
    expect(
      contributionOptionsFromDocuments([
        {
          id: '2026-07-01',
          data: { month: '2026-07-01', balance: 125 },
        },
        {
          id: '2026-08-01',
          data: { month: '2026-08-01', balance: 500 },
        },
      ]),
    ).toEqual({
      options: [
        { id: '2026-08-01', month: '2026-08-01', balance: 500 },
        { id: '2026-07-01', month: '2026-07-01', balance: 125 },
      ],
      invalidDocumentCount: 0,
    });
  });

  it('excludes fully paid contributions', () => {
    expect(
      contributionOptionsFromDocuments([
        {
          id: '2026-08-01',
          data: { month: '2026-08-01', balance: 0 },
        },
      ]).options,
    ).toEqual([]);
  });

  it('ignores unrelated legacy fields and isolates invalid records', () => {
    expect(
      contributionOptionsFromDocuments([
        {
          id: '2026-08-01',
          data: {
            month: '2026-08-01',
            balance: 500,
            membernumber: 'legacy-format',
          },
        },
        { id: 'invalid', data: { month: 'invalid', balance: '500' } },
      ]),
    ).toEqual({
      options: [{ id: '2026-08-01', month: '2026-08-01', balance: 500 }],
      invalidDocumentCount: 1,
    });
  });

  it('uses the document ID when a legacy document has no month field', () => {
    expect(
      contributionOptionsFromDocuments([
        { id: '2026-08-01', data: { balance: 500 } },
      ]).options[0]?.month,
    ).toBe('2026-08-01');
  });
});
