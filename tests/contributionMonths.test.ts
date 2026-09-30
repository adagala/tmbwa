import { describe, expect, it } from 'vitest';
import {
  contributionMonthKey,
  missingContributionMonths,
  nairobiContributionMonth,
} from 'tmbwa-shared';

describe('missing contribution months', () => {
  it('lists every month from the join month through the current month without a contribution', () => {
    expect(
      missingContributionMonths(
        new Date('2026-05-15T09:00:00+03:00'),
        ['2026-06-01', '2026-08-01'],
        '2026-09-01',
      ),
    ).toEqual(['2026-05-01', '2026-07-01', '2026-09-01']);
  });

  it('treats legacy YYYY-MM ids as existing months', () => {
    expect(
      missingContributionMonths(
        new Date('2026-05-15T09:00:00+03:00'),
        ['2026-05', '2026-06'],
        '2026-07-01',
      ),
    ).toEqual(['2026-07-01']);
  });

  it('crosses year boundaries in order', () => {
    expect(
      missingContributionMonths(
        new Date('2025-11-02T09:00:00+03:00'),
        [],
        '2026-02-01',
      ),
    ).toEqual(['2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01']);
  });

  it('uses the Nairobi month of the join date', () => {
    // 22:30 UTC on 31 January is already 1 February in Nairobi.
    const joinedAt = new Date('2026-01-31T22:30:00Z');
    expect(nairobiContributionMonth(joinedAt)).toBe('2026-02-01');
    expect(missingContributionMonths(joinedAt, [], '2026-03-01')).toEqual([
      '2026-02-01',
      '2026-03-01',
    ]);
  });

  it('suggests nothing without a valid join date or when fully billed', () => {
    expect(missingContributionMonths(undefined, [], '2026-09-01')).toEqual([]);
    expect(missingContributionMonths(new Date('invalid'), [], '2026-09-01')).toEqual([]);
    expect(
      missingContributionMonths(
        new Date('2026-08-01T09:00:00+03:00'),
        ['2026-08-01', '2026-09-01'],
        '2026-09-01',
      ),
    ).toEqual([]);
    expect(
      missingContributionMonths(new Date('2026-10-05T09:00:00+03:00'), [], '2026-09-01'),
    ).toEqual([]);
  });

  it('compares months by their YYYY-MM key', () => {
    expect(contributionMonthKey('2026-05-01')).toBe('2026-05');
    expect(contributionMonthKey('2026-05')).toBe('2026-05');
  });
});
