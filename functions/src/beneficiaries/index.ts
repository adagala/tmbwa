import { admin } from '../firebaseAdmin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  auditEventDocumentSchema,
  beneficiaryChangeReasonSchema,
  beneficiaryChangeRequestDocumentSchema,
  beneficiaryDocumentSchema,
  beneficiaryListSchema,
  beneficiaryStateDocumentSchema,
  notificationEventDocumentSchema,
  type Beneficiary,
  type BeneficiaryChangeReason,
} from 'tmbwa-shared';
import {
  classifyBeneficiaryRequest,
  isValidBeneficiaryRequestId,
  lastAnnualChangeYearAfterApproval,
  nairobiYear,
} from './domain';
import {
  beneficiaryChangeRequestData,
  beneficiaryStateData,
  validateDocumentWrite,
} from '../firestoreData';
import { assertActorActive, requirePermission } from '../authorization';

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
  actorRoles?: string[],
) => {
  const path = `audit_events/${action.replace(/[._]/g, '-')}-${requestId}`;
  // Record IDs and counts only, never beneficiary personal details.
  transaction.create(db().doc(path), validateDocumentWrite(auditEventDocumentSchema, {
    requestId,
    actorId,
    ...(actorRoles && { actorRoles }),
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

// A request ID is a retry only when the same command, caller and member
// created it; any other reuse is refused rather than reported as success.
const existingRequestResult = (
  snapshot: FirebaseFirestore.DocumentSnapshot,
  expected: { origin: 'member' | 'administrator'; memberId: string; submittedBy: string },
  requestId: string,
) => {
  const existing = beneficiaryChangeRequestData(snapshot);
  if (
    existing.origin !== expected.origin ||
    existing.memberId !== expected.memberId ||
    existing.submittedBy !== expected.submittedBy
  ) {
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
    // Check status first so a retry cannot reveal a request to an inactive member.
    await requireActiveMember(transaction, memberId);
    if (existingRequest.exists) {
      return existingRequestResult(existingRequest, { origin: 'member', memberId, submittedBy: memberId }, requestId);
    }
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
      origin: 'member',
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
    await requireActiveMember(transaction, memberId);
    const changeRequest = beneficiaryChangeRequestData(snapshot);
    if (changeRequest.status === 'cancelled') {
      return { requestId, type: changeRequest.type, status: 'cancelled', duplicate: true };
    }
    if (changeRequest.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'Only pending requests can be cancelled.');
    }
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
  const { actorId, actorRoles } = await requirePermission(request.auth, 'beneficiaries.review');
  const data = request.data as CommandData;
  const requestId = requireRequestId(data);
  const memberId = typeof data.memberId === 'string' ? data.memberId.trim() : '';
  if (!memberId) throw new HttpsError('invalid-argument', 'memberId is required.');
  // No one approves their own beneficiaries: administrators submit theirs as
  // members, for another administrator to review.
  if (memberId === actorId) {
    throw new HttpsError(
      'permission-denied',
      'Administrators cannot set their own beneficiaries. Submit them as a member for another administrator to approve.',
    );
  }
  const beneficiaries = parseInput(beneficiaryListSchema, data.beneficiaries);

  return db().runTransaction(async (transaction) => {
    await assertActorActive(transaction, actorId);
    const existingRequest = await transaction.get(requestRef(requestId));
    if (existingRequest.exists) {
      return existingRequestResult(
        existingRequest,
        { origin: 'administrator', memberId, submittedBy: actorId },
        requestId,
      );
    }
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
      origin: 'administrator',
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
    }, actorRoles);
    return { requestId, type: 'initial', status: 'approved', duplicate: false };
  });
});

const MAX_REVIEW_NOTE_LENGTH = 500;

const reviewNote = (value: unknown, required: boolean) => {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw new HttpsError('invalid-argument', 'reviewNote must be text.');
  }
  const note = typeof value === 'string' ? value.trim() : '';
  if (required && !note) throw new HttpsError('invalid-argument', 'A note is required to reject a request.');
  if (note.length > MAX_REVIEW_NOTE_LENGTH) {
    throw new HttpsError('invalid-argument', `reviewNote must be at most ${MAX_REVIEW_NOTE_LENGTH} characters.`);
  }
  return note || undefined;
};

const timestampDate = (value: unknown) =>
  value && typeof (value as { toDate?: unknown }).toDate === 'function'
    ? (value as { toDate: () => Date }).toDate()
    : undefined;

type Decision = 'approved' | 'rejected';

// Shared by approve and reject: one transaction records the decision, the
// audit event and the member notification, or nothing at all.
const reviewBeneficiaryChange = async (
  actorId: string,
  actorRoles: string[],
  requestId: string,
  decision: Decision,
  note: string | undefined,
) =>
  db().runTransaction(async (transaction) => {
    await assertActorActive(transaction, actorId);
    const snapshot = await transaction.get(requestRef(requestId));
    if (!snapshot.exists) throw new HttpsError('not-found', 'Beneficiary change request not found.');
    const changeRequest = beneficiaryChangeRequestData(snapshot);
    const { memberId } = changeRequest;
    // No one reviews their own beneficiaries; a member who is also an
    // administrator cancels their own request instead of rejecting it.
    if (memberId === actorId) {
      throw new HttpsError(
        'permission-denied',
        'Administrators cannot review their own beneficiary change. Another administrator must review it.',
      );
    }
    if (changeRequest.status === decision) {
      return { requestId, memberId, status: decision, duplicate: true };
    }
    if (changeRequest.status !== 'pending') {
      throw new HttpsError('failed-precondition', `This request is already ${changeRequest.status}.`);
    }
    // Reading the member also serializes this decision against member deletion.
    const memberExists = (await transaction.get(db().doc(`members/${memberId}`))).exists;
    if (decision === 'approved' && !memberExists) {
      throw new HttpsError('failed-precondition', 'This member no longer exists. Reject the request instead.');
    }
    const state = beneficiaryStateData(await transaction.get(stateRef(memberId)));

    let nextState = { ...state, pendingRequestId: state.pendingRequestId === requestId ? null : state.pendingRequestId };
    if (decision === 'approved') {
      // The approved list changed after the member submitted: refuse to overwrite it.
      if (state.version !== changeRequest.baseVersion) {
        throw new HttpsError(
          'failed-precondition',
          'The member\'s beneficiaries changed after this request was made. Reject it and ask the member to resubmit.',
        );
      }
      // Still before any write, as transactions require.
      const existing = await transaction.get(beneficiariesRef(memberId));
      const submittedYear = nairobiYear(timestampDate(snapshot.get('submittedAt')) ?? new Date());
      nextState = {
        ...nextState,
        version: state.version + 1,
        lastAnnualChangeYear: lastAnnualChangeYearAfterApproval(
          changeRequest.type,
          state.lastAnnualChangeYear,
          submittedYear,
        ),
      };
      replaceApprovedBeneficiaries(
        transaction,
        memberId,
        existing,
        changeRequest.proposedBeneficiaries,
        requestId,
        actorId,
      );
    }

    transaction.update(snapshot.ref, {
      status: decision,
      reviewedBy: actorId,
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(note && { reviewNote: note }),
    });
    writeState(transaction, memberId, {
      version: nextState.version,
      lastAnnualChangeYear: nextState.lastAnnualChangeYear,
      pendingRequestId: nextState.pendingRequestId,
    });
    const action = decision === 'approved' ? 'beneficiary.change_approved' : 'beneficiary.change_rejected';
    writeBeneficiaryAuditEvent(transaction, action, requestId, actorId, memberId, {
      type: changeRequest.type,
      beneficiaryCount: changeRequest.proposedBeneficiaries.length,
      ...(decision === 'approved' && { version: nextState.version }),
      ...(decision === 'approved' && changeRequest.type === 'annual' && {
        annualChangeYear: nextState.lastAnnualChangeYear,
      }),
    }, actorRoles);
    // A deleted member's request can still be rejected to close it, but there
    // is no one left to notify.
    if (memberExists) {
      const notificationPath = `notification_events/${action.replace(/[._]/g, '-')}-${requestId}`;
      transaction.create(db().doc(notificationPath), validateDocumentWrite(notificationEventDocumentSchema, {
        type: action,
        memberId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }, notificationPath));
    }
    return { requestId, memberId, status: decision, duplicate: false };
  });

export const approveBeneficiaryChange = onCall(async (request) => {
  const { actorId, actorRoles } = await requirePermission(request.auth, 'beneficiaries.review');
  const data = request.data as CommandData;
  const requestId = requireRequestId(data);
  return reviewBeneficiaryChange(actorId, actorRoles, requestId, 'approved', reviewNote(data.reviewNote, false));
});

export const rejectBeneficiaryChange = onCall(async (request) => {
  const { actorId, actorRoles } = await requirePermission(request.auth, 'beneficiaries.review');
  const data = request.data as CommandData;
  const requestId = requireRequestId(data);
  return reviewBeneficiaryChange(actorId, actorRoles, requestId, 'rejected', reviewNote(data.reviewNote, true));
});
