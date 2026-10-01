import type { BeneficiaryChangeRequestType, BeneficiaryState } from 'tmbwa-shared';
import { nairobiDateKey } from 'tmbwa-shared';

// Calendar year in Africa/Nairobi; the annual change allowance resets on 1 January.
export const nairobiYear = (date: Date) => Number(nairobiDateKey(date).slice(0, 4));

export type BeneficiaryRequestClassification =
  | { allowed: true; type: BeneficiaryChangeRequestType }
  | { allowed: false; reason: 'pending_request' | 'reason_required' };

// The server decides the request type; the client never supplies it.
// - No approved list yet: `initial`, which never uses the annual allowance.
// - Annual allowance unused this calendar year: `annual`.
// - Otherwise a reason is required and the request is `exceptional`.
export const classifyBeneficiaryRequest = (
  state: Pick<BeneficiaryState, 'version' | 'lastAnnualChangeYear' | 'pendingRequestId'>,
  currentYear: number,
  hasReason: boolean,
): BeneficiaryRequestClassification => {
  if (state.pendingRequestId) return { allowed: false, reason: 'pending_request' };
  if (state.version === 0) return { allowed: true, type: 'initial' };
  if (state.lastAnnualChangeYear !== currentYear) return { allowed: true, type: 'annual' };
  if (!hasReason) return { allowed: false, reason: 'reason_required' };
  return { allowed: true, type: 'exceptional' };
};

// Firestore document IDs come from the client, so restrict them to a safe shape.
export const isValidBeneficiaryRequestId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);

// An approved annual change uses the allowance of the year it was submitted,
// so a December request approved in January leaves the new year's change free.
// Initial and exceptional changes never use the allowance.
export const lastAnnualChangeYearAfterApproval = (
  type: BeneficiaryChangeRequestType,
  lastAnnualChangeYear: number | null,
  submittedYear: number,
) =>
  type === 'annual'
    ? Math.max(lastAnnualChangeYear ?? submittedYear, submittedYear)
    : lastAnnualChangeYear;
