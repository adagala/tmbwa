import { describe, expect, it } from 'vitest';
import {
  dateFromKey,
  expectedRequestKind,
  formatDateOfBirth,
  reasonLabel,
  relationshipLabel,
} from '../src/lib/beneficiaryDisplay';

const state = { version: 1, lastAnnualChangeYear: null, pendingRequestId: null };
// 10:00 on 15 September 2026 in Nairobi.
const now = new Date('2026-09-15T07:00:00Z');

describe('beneficiary display helpers', () => {
  it('predicts the request type the server will assign', () => {
    expect(expectedRequestKind({ ...state, version: 0 }, now)).toBe('initial');
    expect(expectedRequestKind(state, now)).toBe('annual');
    expect(expectedRequestKind({ ...state, lastAnnualChangeYear: 2025 }, now)).toBe('annual');
    expect(expectedRequestKind({ ...state, lastAnnualChangeYear: 2026 }, now)).toBe('reason_required');
    expect(expectedRequestKind({ ...state, pendingRequestId: 'request-1' }, now)).toBe('pending');
  });

  it('uses the Nairobi calendar year', () => {
    // 00:30 on 1 January 2027 in Nairobi is still 31 December in UTC.
    const newYear = new Date('2026-12-31T21:30:00Z');
    expect(expectedRequestKind({ ...state, lastAnnualChangeYear: 2026 }, newYear)).toBe('annual');
  });

  it('labels relationships and reasons', () => {
    expect(relationshipLabel({ relationship: 'father_in_law' })).toBe('Father-in-law');
    expect(relationshipLabel({ relationship: 'other', relationshipOther: 'Godchild' })).toBe('Godchild');
    expect(reasonLabel({ category: 'marriage' })).toBe('Marriage');
    expect(reasonLabel({ category: 'other', text: 'Name change' })).toBe('Other: Name change');
  });

  it('round-trips calendar dates without a time-zone shift', () => {
    const date = dateFromKey('2012-06-14');
    expect([date?.getFullYear(), date?.getMonth(), date?.getDate()]).toEqual([2012, 5, 14]);
    expect(dateFromKey('')).toBeUndefined();
    expect(dateFromKey('14/06/2012')).toBeUndefined();
    expect(formatDateOfBirth('2012-06-14')).toContain('2012');
  });
});
