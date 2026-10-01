import { admin } from '../firebaseAdmin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  MEMBER_STATUS,
  ROLE,
  type Role,
  auditEventDocumentSchema,
  legacyRoleFor,
  memberRoles,
  normalizeRoles,
  roles as knownRoles,
  sameRoles,
} from 'tmbwa-shared';
import { assertActorActive, requirePermission } from '../authorization';
import { validateDocumentWrite } from '../firestoreData';

type CommandData = Record<string, unknown>;

export const MAX_ROLE_REASON_LENGTH = 500;

const db = () => admin.firestore();

const requiredString = (data: CommandData, key: string) => {
  const value = data[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpsError('invalid-argument', `${key} is required.`);
  }
  return value.trim();
};

const requestIdPattern = /^[A-Za-z0-9_-]{8,128}$/;

const requestedRoles = (value: unknown) => {
  if (
    !Array.isArray(value) ||
    value.some((role) => !(knownRoles as readonly unknown[]).includes(role))
  ) {
    throw new HttpsError('invalid-argument', 'roles must list known roles only.');
  }
  return normalizeRoles(value);
};

const auditAction = (granted: Role[], revoked: Role[]) => {
  if (granted.length && revoked.length) return 'role.changed';
  return granted.length ? 'role.granted' : 'role.revoked';
};

// Removing super_admin must leave another active super admin, or nobody could
// manage roles again. Legacy administrators count until the backfill runs.
const assertAnotherSuperAdmin = async (
  transaction: FirebaseFirestore.Transaction,
  memberId: string,
) => {
  const members = db().collection('members');
  const [assigned, legacy] = await Promise.all([
    transaction.get(members.where('roles', 'array-contains', ROLE.SUPER_ADMIN)),
    transaction.get(members.where('role', '==', 'administrator')),
  ]);
  const remaining = [...assigned.docs, ...legacy.docs].some(
    (member) =>
      member.id !== memberId &&
      member.get('status') === MEMBER_STATUS.ACTIVE &&
      memberRoles(member.data()).includes(ROLE.SUPER_ADMIN),
  );
  if (!remaining) {
    throw new HttpsError(
      'failed-precondition',
      'At least one other active super admin must remain.',
    );
  }
};

// Replaces a member's roles. Only super admins hold roles.manage. The member
// record is the source of truth; custom claims mirror it for Firestore rules
// and the interface, and existing sessions are revoked so the change applies
// on the member's next request.
export const assignMemberRoles = onCall(async (request) => {
  const actor = await requirePermission(request.auth, 'roles.manage');
  const { actorId, actorRoles } = actor;
  const data = (request.data ?? {}) as CommandData;
  const requestId = requiredString(data, 'requestId');
  if (!requestIdPattern.test(requestId)) {
    throw new HttpsError(
      'invalid-argument',
      'requestId must be 8 to 128 letters, digits, "-" or "_".',
    );
  }
  const memberId = requiredString(data, 'memberId');
  if (memberId === actorId) {
    throw new HttpsError(
      'permission-denied',
      'You cannot change your own roles. Another super admin must do it.',
    );
  }
  const roles = requestedRoles(data.roles);
  const reason = requiredString(data, 'reason');
  if (reason.length > MAX_ROLE_REASON_LENGTH) {
    throw new HttpsError(
      'invalid-argument',
      `reason must be at most ${MAX_ROLE_REASON_LENGTH} characters.`,
    );
  }

  const result = await db().runTransaction(async (transaction) => {
    await assertActorActive(transaction, actorId, 'roles.manage');
    const commandRef = db().doc(`role_assignments/${requestId}`);
    const memberRef = db().doc(`members/${memberId}`);
    const [command, member] = await Promise.all([
      transaction.get(commandRef),
      transaction.get(memberRef),
    ]);
    if (command.exists) {
      if (command.get('memberId') !== memberId) {
        throw new HttpsError(
          'already-exists',
          'This requestId was already used for another member.',
        );
      }
      // The member may have been deleted since; there are no claims to repair.
      if (!member.exists) return { requestId, memberId, roles: [], duplicate: true };
      return {
        requestId,
        memberId,
        roles: memberRoles(member.data()),
        duplicate: true,
      };
    }
    if (!member.exists) throw new HttpsError('not-found', 'Member not found.');
    const previousRoles = memberRoles(member.data());
    if (sameRoles(previousRoles, roles)) {
      throw new HttpsError(
        'failed-precondition',
        'The member already has exactly these roles.',
      );
    }
    const granted = roles.filter((role) => !previousRoles.includes(role));
    const revoked = previousRoles.filter((role) => !roles.includes(role));
    if (granted.length && member.get('status') !== MEMBER_STATUS.ACTIVE) {
      throw new HttpsError(
        'failed-precondition',
        'Only active members can be granted roles.',
      );
    }
    if (revoked.includes(ROLE.SUPER_ADMIN)) {
      await assertAnotherSuperAdmin(transaction, memberId);
    }

    transaction.create(commandRef, {
      memberId,
      actorId,
      actorRoles,
      previousRoles,
      roles,
      reason,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.update(memberRef, {
      roles,
      role: legacyRoleFor(roles),
      rolesUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      rolesUpdatedBy: actorId,
    });
    const auditPath = `audit_events/role-assignment-${requestId}`;
    transaction.create(
      db().doc(auditPath),
      validateDocumentWrite(
        auditEventDocumentSchema,
        {
          requestId,
          actorId,
          actorRoles,
          action: auditAction(granted, revoked),
          memberId,
          targetId: memberId,
          changes: { previousRoles, roles, granted, revoked, reason },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        auditPath,
      ),
    );
    return { requestId, memberId, previousRoles, roles, duplicate: false };
  });

  // Claims mirror the record, so a retry also repairs claims left stale by a
  // failure after the transaction committed.
  if (!result.roles.length) return result;
  await admin.auth().setCustomUserClaims(memberId, {
    role: legacyRoleFor(result.roles),
    roles: result.roles,
  });
  if (!result.duplicate) await admin.auth().revokeRefreshTokens(memberId);
  return result;
});
