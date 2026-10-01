import {
  BENEFICIARY_CHANGE_REASON_LABELS,
  BENEFICIARY_RELATIONSHIP_LABELS,
  Beneficiary,
  BeneficiaryChangeReason,
  BeneficiaryChangeRequestStatus,
  BeneficiaryChangeRequestType,
  BeneficiaryState,
  nairobiDateKey,
} from 'tmbwa-shared';
import { formatNairobiDateTime, timestampDate } from './financialReporting';

export const relationshipLabel = (
  beneficiary: Pick<Beneficiary, 'relationship' | 'relationshipOther'>,
) =>
  beneficiary.relationship === 'other' && beneficiary.relationshipOther
    ? beneficiary.relationshipOther
    : BENEFICIARY_RELATIONSHIP_LABELS[beneficiary.relationship];

export const reasonLabel = (reason: BeneficiaryChangeReason) =>
  BENEFICIARY_CHANGE_REASON_LABELS[reason.category] +
  (reason.text ? `: ${reason.text}` : '');

export const requestTypeLabel: Record<BeneficiaryChangeRequestType, string> = {
  initial: 'First entry',
  annual: 'Yearly change',
  exceptional: 'Extra change',
};

export const requestStatusLabel: Record<
  BeneficiaryChangeRequestStatus,
  string
> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Not approved',
  cancelled: 'Cancelled',
};

export const requestStatusVariant: Record<
  BeneficiaryChangeRequestStatus,
  'warning' | 'success' | 'error' | 'neutral'
> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
  cancelled: 'neutral',
};

// `YYYY-MM-DD` calendar dates, shown without any time-zone shift.
export const formatDateOfBirth = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-KE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

export const dateFromKey = (value: string | undefined) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export const formatRequestTime = (value: unknown) => {
  const date = timestampDate(value as Parameters<typeof timestampDate>[0]);
  return date ? formatNairobiDateTime(date) : 'Just now';
};

export type ExpectedRequestKind =
  | 'initial'
  | 'annual'
  | 'reason_required'
  | 'pending';

// Display only: the server decides the request type when it is submitted.
export const expectedRequestKind = (
  state: BeneficiaryState,
  now = new Date(),
): ExpectedRequestKind => {
  if (state.pendingRequestId) return 'pending';
  if (state.version === 0) return 'initial';
  const year = Number(nairobiDateKey(now).slice(0, 4));
  return state.lastAnnualChangeYear === year ? 'reason_required' : 'annual';
};

// The current-beneficiary snapshot an administrator compares a request with.
// Tagged with its member so a previous member's list is never reused.
export type ComparisonLoad<Item> =
  | { memberId: string; status: 'loading' }
  | { memberId: string; status: 'error' }
  | { memberId: string; status: 'loaded'; beneficiaries: Item[] };

// Approval replaces the member's list, so it waits until the administrator
// can see that list; a failed load must never pass for an empty one.
export const reviewActions = <Item>({
  requestStatus,
  isOwnRequest,
  memberId,
  comparison,
}: {
  requestStatus: BeneficiaryChangeRequestStatus;
  isOwnRequest: boolean;
  memberId: string;
  comparison: ComparisonLoad<Item>;
}) => {
  const canReview = requestStatus === 'pending' && !isOwnRequest;
  return {
    canReview,
    canApprove:
      canReview &&
      comparison.memberId === memberId &&
      comparison.status === 'loaded',
  };
};
