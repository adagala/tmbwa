import { describe, expect, it } from 'vitest';
import {
  dateFromKey,
  expectedRequestKind,
  formatDateOfBirth,
  reasonLabel,
  relationshipLabel,
  reviewActions,
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

describe('beneficiary review actions', () => {
  const base = { requestStatus: 'pending' as const, isOwnRequest: false, memberId: 'member-1' };
  const loaded = { memberId: 'member-1', status: 'loaded' as const, beneficiaries: [] };

  it('allows approval only once the current list has loaded for this member', () => {
    expect(reviewActions({ ...base, comparison: loaded })).toEqual({ canReview: true, canApprove: true });
    // Still loading (a delayed listener).
    expect(reviewActions({ ...base, comparison: { memberId: 'member-1', status: 'loading' } }))
      .toEqual({ canReview: true, canApprove: false });
    // The listener reported an error.
    expect(reviewActions({ ...base, comparison: { memberId: 'member-1', status: 'error' } }))
      .toEqual({ canReview: true, canApprove: false });
    // A list left over from the previously reviewed member.
    expect(reviewActions({ ...base, comparison: { ...loaded, memberId: 'member-2' } }))
      .toEqual({ canReview: true, canApprove: false });
  });

  it('allows no review of own or non-pending requests', () => {
    expect(reviewActions({ ...base, isOwnRequest: true, comparison: loaded }))
      .toEqual({ canReview: false, canApprove: false });
    expect(reviewActions({ ...base, requestStatus: 'approved', comparison: loaded }))
      .toEqual({ canReview: false, canApprove: false });
  });
});
