import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  type Query,
} from 'firebase/firestore';
import {
  BeneficiaryChangeReason,
  BeneficiaryChangeRequest,
  BeneficiaryChangeRequestStatus,
  BeneficiaryDocument,
  BeneficiaryInput,
  BeneficiaryState,
  beneficiaryChangeRequestDocumentSchema,
  beneficiaryDocumentSchema,
  beneficiaryStateDocumentSchema,
  parseDocument,
} from 'tmbwa-shared';
import { db } from './clientApp';
import { callWithRequestId } from './financial';

export type BeneficiaryRecord = BeneficiaryDocument & { id: string };
export type BeneficiaryRequestRecord = BeneficiaryChangeRequest & {
  id: string;
};

const seconds = (value: unknown) =>
  value && typeof value === 'object' && 'seconds' in value
    ? Number((value as { seconds: number }).seconds)
    : // Pending server timestamps sort as newest.
      Number.MAX_SAFE_INTEGER;

const newestFirst = (
  a: BeneficiaryRequestRecord,
  b: BeneficiaryRequestRecord,
) => seconds(b.submittedAt) - seconds(a.submittedAt);

const subscribeRequests = (
  requestsQuery: Query,
  cb: (requests: BeneficiaryRequestRecord[]) => void,
  onError?: (error: Error) => void,
) =>
  onSnapshot(
    requestsQuery,
    (snapshot) =>
      // Sorted here rather than with orderBy so no composite index is needed.
      cb(
        snapshot.docs
          .map((item) => ({
            id: item.id,
            ...parseDocument(
              beneficiaryChangeRequestDocumentSchema,
              item.data(),
              item.ref.path,
            ),
          }))
          .sort(newestFirst),
      ),
    onError,
  );

export const subscribeBeneficiaries = (
  memberId: string,
  cb: (beneficiaries: BeneficiaryRecord[]) => void,
  onError?: (error: Error) => void,
) =>
  onSnapshot(
    collection(db, 'members', memberId, 'beneficiaries'),
    (snapshot) =>
      cb(
        snapshot.docs
          .map((item) => ({
            id: item.id,
            ...parseDocument(
              beneficiaryDocumentSchema,
              item.data(),
              item.ref.path,
            ),
          }))
          .sort((a, b) => a.firstname.localeCompare(b.firstname)),
      ),
    onError,
  );

// A member without a state document has never had beneficiaries approved.
export const subscribeBeneficiaryState = (
  memberId: string,
  cb: (state: BeneficiaryState) => void,
  onError?: (error: Error) => void,
) =>
  onSnapshot(
    doc(db, 'members', memberId, 'beneficiary_state', 'current'),
    (snapshot) =>
      cb(
        parseDocument(
          beneficiaryStateDocumentSchema,
          snapshot.exists() ? snapshot.data() : { version: 0 },
          snapshot.ref.path,
        ),
      ),
    onError,
  );

// Members may only query their own requests; the rules require this filter.
export const subscribeMemberBeneficiaryRequests = (
  memberId: string,
  cb: (requests: BeneficiaryRequestRecord[]) => void,
  onError?: (error: Error) => void,
) =>
  subscribeRequests(
    query(
      collection(db, 'beneficiary_change_requests'),
      where('memberId', '==', memberId),
    ),
    cb,
    onError,
  );

// Administrators only.
export const subscribeBeneficiaryRequests = (
  status: BeneficiaryChangeRequestStatus | 'all',
  cb: (requests: BeneficiaryRequestRecord[]) => void,
  onError?: (error: Error) => void,
) =>
  subscribeRequests(
    status === 'all'
      ? query(collection(db, 'beneficiary_change_requests'))
      : query(
          collection(db, 'beneficiary_change_requests'),
          where('status', '==', status),
        ),
    cb,
    onError,
  );

export const subscribePendingBeneficiaryRequestCount = (
  cb: (count: number) => void,
) =>
  onSnapshot(
    query(
      collection(db, 'beneficiary_change_requests'),
      where('status', '==', 'pending'),
    ),
    (snapshot) => cb(snapshot.size),
    () => cb(0),
  );

export const submitBeneficiaryChange = (
  beneficiaries: BeneficiaryInput[],
  reason?: BeneficiaryChangeReason,
) =>
  callWithRequestId('submitBeneficiaryChange', {
    beneficiaries,
    ...(reason && { reason }),
  });

export const cancelBeneficiaryChange = (requestId: string) =>
  // The request's own ID is the command's idempotency key.
  callWithRequestId('cancelBeneficiaryChange', {}, requestId);

export const setInitialBeneficiaries = (
  memberId: string,
  beneficiaries: BeneficiaryInput[],
) => callWithRequestId('setInitialBeneficiaries', { memberId, beneficiaries });

export const approveBeneficiaryChange = (
  requestId: string,
  reviewNote?: string,
) =>
  callWithRequestId(
    'approveBeneficiaryChange',
    reviewNote ? { reviewNote } : {},
    requestId,
  );

export const rejectBeneficiaryChange = (
  requestId: string,
  reviewNote: string,
) => callWithRequestId('rejectBeneficiaryChange', { reviewNote }, requestId);

// Callable errors carry the server's message, which is written for users.
export const commandErrorMessage = (error: unknown, fallback: string) =>
  (error as { message?: string }).message || fallback;
