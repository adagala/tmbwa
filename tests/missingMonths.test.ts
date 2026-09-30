import { describe, expect, it } from 'vitest';
import {
  monthsCoveredByCredit,
  previewMissingMonths,
  unreservedCredit,
} from '../src/lib/missingMonths';

const months = ['2026-08-01', '2026-01-01', '2026-04-01', '2026-02-01'];

describe('missing months preview', () => {
  it('applies unreserved credit to the oldest month first', () => {
    expect(previewMissingMonths(months, { balance: 700 })).toEqual({
      rows: [
        { month: '2026-01-01', fromCredit: 500, due: 0 },
        { month: '2026-02-01', fromCredit: 200, due: 300 },
        { month: '2026-04-01', fromCredit: 0, due: 500 },
        { month: '2026-08-01', fromCredit: 0, due: 500 },
      ],
      total: 2000,
      fromCredit: 700,
      balanceAfter: -1300,
    });
  });

  it('ignores reserved and negative balances', () => {
    expect(unreservedCredit({ balance: 600, reservedKcbCredit: 400 })).toBe(200);
    expect(unreservedCredit({ balance: -300 })).toBe(0);
    expect(previewMissingMonths(['2026-01-01'], { balance: -300 })).toMatchObject({
      fromCredit: 0,
      balanceAfter: -800,
    });
  });

  it('lists only the oldest months that credit pays in full', () => {
    expect(monthsCoveredByCredit(months, { balance: 1200 })).toEqual([
      '2026-01-01',
      '2026-02-01',
    ]);
    expect(monthsCoveredByCredit(months, { balance: 499 })).toEqual([]);
  });
});
