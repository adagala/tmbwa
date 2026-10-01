import { describe, expect, it } from 'vitest';
import {
  classifyBeneficiaryRequest,
  isValidBeneficiaryRequestId,
  nairobiYear,
} from '../functions/src/beneficiaries/domain';

const state = { version: 2, lastAnnualChangeYear: null, pendingRequestId: null };

describe('beneficiary request classification', () => {
  it('uses the Nairobi calendar year', () => {
    // 21:30 UTC on 31 December is 00:30 on 1 January in Nairobi.
    expect(nairobiYear(new Date('2026-12-31T20:59:59Z'))).toBe(2026);
    expect(nairobiYear(new Date('2026-12-31T21:30:00Z'))).toBe(2027);
  });

  it('treats a member without approved beneficiaries as an initial request', () => {
    expect(classifyBeneficiaryRequest({ ...state, version: 0 }, 2026, false))
      .toEqual({ allowed: true, type: 'initial' });
    // Even after an annual change in a past life, an empty history is initial.
    expect(classifyBeneficiaryRequest({ ...state, version: 0, lastAnnualChangeYear: 2026 }, 2026, false))
      .toEqual({ allowed: true, type: 'initial' });
  });

  it('allows one annual change per calendar year', () => {
    expect(classifyBeneficiaryRequest(state, 2026, false)).toEqual({ allowed: true, type: 'annual' });
    expect(classifyBeneficiaryRequest({ ...state, lastAnnualChangeYear: 2025 }, 2026, false))
      .toEqual({ allowed: true, type: 'annual' });
    expect(classifyBeneficiaryRequest({ ...state, lastAnnualChangeYear: 2026 }, 2026, false))
      .toEqual({ allowed: false, reason: 'reason_required' });
    // The allowance resets on 1 January.
    expect(classifyBeneficiaryRequest({ ...state, lastAnnualChangeYear: 2026 }, 2027, false))
      .toEqual({ allowed: true, type: 'annual' });
  });

  it('keeps the annual change when one is available, even if a reason is given', () => {
    expect(classifyBeneficiaryRequest(state, 2026, true)).toEqual({ allowed: true, type: 'annual' });
  });

  it('requires a reason once the annual change is used', () => {
    expect(classifyBeneficiaryRequest({ ...state, lastAnnualChangeYear: 2026 }, 2026, true))
      .toEqual({ allowed: true, type: 'exceptional' });
  });

  it('rejects any request while another is pending', () => {
    for (const version of [0, 2]) {
      expect(classifyBeneficiaryRequest({ ...state, version, pendingRequestId: 'request-1' }, 2026, true))
        .toEqual({ allowed: false, reason: 'pending_request' });
    }
  });

  it('accepts only document-safe request IDs', () => {
    expect(isValidBeneficiaryRequestId('3f2b9c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e')).toBe(true);
    for (const value of ['short', 'has/slash-in-it', '../../members/x', 'a'.repeat(129), 42, undefined]) {
      expect(isValidBeneficiaryRequestId(value)).toBe(false);
    }
  });
});
