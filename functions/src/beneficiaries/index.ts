import { admin } from '../firebaseAdmin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  auditEventDocumentSchema,
  beneficiaryChangeReasonSchema,
  beneficiaryChangeRequestDocumentSchema,
  beneficiaryDocumentSchema,
  beneficiaryListSchema,
  beneficiaryStateDocumentSchema,
  type Beneficiary,
  type BeneficiaryChangeReason,
} from 'tmbwa-shared';
import { classifyBeneficiaryRequest, isValidBeneficiaryRequestId, nairobiYear } from './domain';
import {
  beneficiaryChangeRequestData,
  beneficiaryStateData,
  validateDocumentWrite,
} from '../firestoreData';

type CommandData = Record<string, unknown>;
type Auth = { uid: string; token: Record<string, unknown> } | undefined;

const db = () => admin.firestore();

const requestRef = (requestId: string) => db().doc(`beneficiary_change_requests/${requestId}`);
const stateRef = (memberId: string) => db().doc(`members/${memberId}/beneficiary_state/current`);
const beneficiariesRef = (memberId: string) => db().collection(`members/${memberId}/beneficiaries`);

const requireSignedIn = (auth: Auth) => {
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in is required.');
  return auth.uid;
};

const requireAdministrator = (auth: Auth) => {
  const uid = requireSignedIn(auth);
  if (auth?.token.role !== 'administrator') {
    throw new HttpsError('permission-denied', 'Administrator access is required.');
  }
  return uid;
};

const requireRequestId = (data: CommandData) => {
  if (!isValidBeneficiaryRequestId(data.requestId)) {
    throw new HttpsError('invalid-argument', 'requestId must be 8 to 128 letters, digits, "-" or "_".');
  }
  return data.requestId;
};

const parseInput = <Result>(
  schema: { safeParse(value: unknown): { success: true; data: Result } | { success: false; error: { issues: { message: string }[] } } },
  value: unknown,
) => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpsError('invalid-argument', result.error.issues[0]?.message ?? 'Invalid input.');
  }
  return result.data;
};

const parseReason = (value: unknown): BeneficiaryChangeReason | undefined =>
  value === undefined || value === null ? undefined : parseInput(beneficiaryChangeReasonSchema, value);

// Legacy member documents may predate `status`; they read as active elsewhere.
const memberStatus = (snapshot: FirebaseFirestore.DocumentSnapshot) => {
  if (!snapshot.exists) throw new HttpsError('not-found', 'Member not found.');
  return (snapshot.get('status') as string | undefined) ?? 'active';
};

const requireActiveMember = async (transaction: FirebaseFirestore.Transaction, memberId: string) => {
  const status = memberStatus(await transaction.get(db().doc(`members/${memberId}`)));
  if (status !== 'active') {
    throw new HttpsError('permission-denied', 'Only active members can change beneficiaries.');
  }
};

// Audit IDs are namespaced: client request IDs are also used by financial commands.
export const writeBeneficiaryAuditEvent = (
  transaction: FirebaseFirestore.Transaction,
  action: string,
  requestId: string,
  actorId: string,
  memberId: string,
  changes: Record<string, unknown>,
) => {
  const path = `audit_events/${action.replace(/[._]/g, '-')}-${requestId}`;
  // Record IDs and counts only, never beneficiary personal details.
  transaction.create(db().doc(path), validateDocumentWrite(auditEventDocumentSchema, {
    requestId,
    actorId,
    action,
    memberId,
    targetId: requestId,
    changes,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, path));
};

// Replaces the member's approved beneficiaries. All reads must happen before
// this is called, so callers pass the existing documents in.
export const replaceApprovedBeneficiaries = (
  transaction: FirebaseFirestore.Transaction,
  memberId: string,
  existing: FirebaseFirestore.QuerySnapshot,
  beneficiaries: Beneficiary[],
  requestId: string,
  actorId: string,
) => {
  existing.docs.forEach((document) => transaction.delete(document.ref));
  beneficiaries.forEach((beneficiary) => {
    const ref = beneficiariesRef(memberId).doc();
    transaction.create(ref, validateDocumentWrite(beneficiaryDocumentSchema, {
      ...beneficiary,
      requestId,
      approvedBy: actorId,
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, ref.path));
  });
};

const writeState = (
  transaction: FirebaseFirestore.Transaction,
  memberId: string,
  state: { version: number; lastAnnualChangeYear: number | null; pendingRequestId: string | null },
) => {
  const ref = stateRef(memberId);
  transaction.set(ref, validateDocumentWrite(beneficiaryStateDocumentSchema, {
    ...state,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, ref.path));
};

const existingRequestResult = (
  snapshot: FirebaseFirestore.DocumentSnapshot,
  memberId: string,
  requestId: string,
) => {
  const existing = beneficiaryChangeRequestData(snapshot);
  if (existing.memberId !== memberId) {
    throw new HttpsError('already-exists', 'This requestId is already in use.');
  }
  return { requestId, type: existing.type, status: existing.status, duplicate: true };
};

export const submitBeneficiaryChange = onCall(async (request) => {
  const memberId = requireSignedIn(request.auth);
  const data = request.data as CommandData;
  const requestId = requireRequestId(data);
  const beneficiaries = parseInput(beneficiaryListSchema, data.beneficiaries);
  const reason = parseReason(data.reason);
  const currentYear = nairobiYear(new Date());

  return db().runTransaction(async (transaction) => {
    const existingRequest = await transaction.get(requestRef(requestId));
    if (existingRequest.exists) return existingRequestResult(existingRequest, memberId, requestId);
    await requireActiveMember(transaction, memberId);
    const state = beneficiaryStateData(await transaction.get(stateRef(memberId)));

    const classification = classifyBeneficiaryRequest(state, currentYear, Boolean(reason));
    if (!classification.allowed) {
      throw new HttpsError(
        'failed-precondition',
        classification.reason === 'pending_request'
          ? 'You already have a pending beneficiary change request.'
          : 'You have already used this year\'s beneficiary change. Choose a reason for this change.',
      );
    }

    const ref = requestRef(requestId);
    transaction.create(ref, validateDocumentWrite(beneficiaryChangeRequestDocumentSchema, {
      memberId,
      type: classification.type,
      ...(reason && { reason }),
      proposedBeneficiaries: beneficiaries,
      baseVersion: state.version,
      status: 'pending',
      submittedBy: memberId,
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, ref.path));
    writeState(transaction, memberId, {
      version: state.version,
      lastAnnualChangeYear: state.lastAnnualChangeYear,
      pendingRequestId: requestId,
    });
    writeBeneficiaryAuditEvent(transaction, 'beneficiary.change_requested', requestId, memberId, memberId, {
      type: classification.type,
      beneficiaryCount: beneficiaries.length,
      baseVersion: state.version,
      ...(reason && { reasonCategory: reason.category }),
    });
    return { requestId, type: classification.type, status: 'pending', duplicate: false };
  });
});

export const cancelBeneficiaryChange = onCall(async (request) => {
  const memberId = requireSignedIn(request.auth);
  const requestId = requireRequestId(request.data as CommandData);

  return db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(requestRef(requestId));
    // Hide other members' requests behind the same error as a missing one.
    if (!snapshot.exists || snapshot.get('memberId') !== memberId) {
      throw new HttpsError('not-found', 'Beneficiary change request not found.');
    }
    const changeRequest = beneficiaryChangeRequestData(snapshot);
    if (changeRequest.status === 'cancelled') {
      return { requestId, type: changeRequest.type, status: 'cancelled', duplicate: true };
    }
    if (changeRequest.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'Only pending requests can be cancelled.');
    }
    await requireActiveMember(transaction, memberId);
    const state = beneficiaryStateData(await transaction.get(stateRef(memberId)));

    transaction.update(snapshot.ref, {
      status: 'cancelled',
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    writeState(transaction, memberId, {
      version: state.version,
      lastAnnualChangeYear: state.lastAnnualChangeYear,
      pendingRequestId: state.pendingRequestId === requestId ? null : state.pendingRequestId,
    });
    writeBeneficiaryAuditEvent(transaction, 'beneficiary.change_cancelled', requestId, memberId, memberId, {
      type: changeRequest.type,
    });
    return { requestId, type: changeRequest.type, status: 'cancelled', duplicate: false };
  });
});

// Administrators record a member's first beneficiaries directly, without the
// approval step. Later changes must come from the member and be approved.
export const setInitialBeneficiaries = onCall(async (request) => {
  const actorId = requireAdministrator(request.auth);
  const data = request.data as CommandData;
  const requestId = requireRequestId(data);
  const memberId = typeof data.memberId === 'string' ? data.memberId.trim() : '';
  if (!memberId) throw new HttpsError('invalid-argument', 'memberId is required.');
  const beneficiaries = parseInput(beneficiaryListSchema, data.beneficiaries);

  return db().runTransaction(async (transaction) => {
    const existingRequest = await transaction.get(requestRef(requestId));
    if (existingRequest.exists) return existingRequestResult(existingRequest, memberId, requestId);
    memberStatus(await transaction.get(db().doc(`members/${memberId}`)));
    const state = beneficiaryStateData(await transaction.get(stateRef(memberId)));
    const existing = await transaction.get(beneficiariesRef(memberId));
    if (state.version !== 0 || !existing.empty) {
      throw new HttpsError('failed-precondition', 'This member already has beneficiaries.');
    }
    if (state.pendingRequestId) {
      throw new HttpsError('failed-precondition', 'This member has a pending beneficiary change request.');
    }

    const ref = requestRef(requestId);
    transaction.create(ref, validateDocumentWrite(beneficiaryChangeRequestDocumentSchema, {
      memberId,
      type: 'initial',
      proposedBeneficiaries: beneficiaries,
      baseVersion: 0,
      status: 'approved',
      submittedBy: actorId,
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
      reviewedBy: actorId,
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, ref.path));
    replaceApprovedBeneficiaries(transaction, memberId, existing, beneficiaries, requestId, actorId);
    writeState(transaction, memberId, {
      version: 1,
      lastAnnualChangeYear: state.lastAnnualChangeYear,
      pendingRequestId: null,
    });
    writeBeneficiaryAuditEvent(transaction, 'beneficiary.initial_set', requestId, actorId, memberId, {
      beneficiaryCount: beneficiaries.length,
      version: 1,
    });
    return { requestId, type: 'initial', status: 'approved', duplicate: false };
  });
});
