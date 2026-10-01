import { admin } from './firebaseAdmin';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  MEMBER_STATUS,
  type Permission,
  type Role,
  memberRoles,
  roleHasPermission,
  rolesFromClaims,
} from 'tmbwa-shared';

export type CallableAuth = { uid: string; token: Record<string, unknown> } | undefined;

// actorRoles are the roles both the token and the member record grant.
// claimedRoles and permission let reauthorizeActor repeat the same check.
export type Actor = {
  actorId: string;
  actorRoles: Role[];
  claimedRoles: Role[];
  permission: Permission;
};

const actorRef = (actorId: string) => admin.firestore().doc(`members/${actorId}`);

const permissionDenied = () =>
  new HttpsError('permission-denied', 'You do not have permission to perform this action.');

// A role counts only when both the caller's token and their member record
// grant it: the token lags behind a revocation until it expires, the record
// does not. The record must also still be active.
const authorize = (
  actorId: string,
  claimedRoles: Role[],
  permission: Permission,
  record: FirebaseFirestore.DocumentSnapshot,
): Actor => {
  if (record.get('status') !== MEMBER_STATUS.ACTIVE) {
    throw new HttpsError('permission-denied', 'Your account is not active.');
  }
  const recordRoles = memberRoles(record.data());
  const actorRoles = claimedRoles.filter((role) => recordRoles.includes(role));
  if (!roleHasPermission(actorRoles, permission)) throw permissionDenied();
  return { actorId, actorRoles, claimedRoles, permission };
};

// Admin SDK writes bypass Firestore rules, so every privileged callable must
// pass through this check before doing any work.
export const requirePermission = async (
  auth: CallableAuth,
  permission: Permission,
): Promise<Actor> => {
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in is required.');
  const claimedRoles = rolesFromClaims(auth.token);
  if (!roleHasPermission(claimedRoles, permission)) throw permissionDenied();
  return authorize(auth.uid, claimedRoles, permission, await actorRef(auth.uid).get());
};

// Privileged mutations must also call this first inside their transaction. It
// repeats the requirePermission check against the actor's member record read
// through the transaction, so a suspension or role revocation that lands
// while the command runs forces a retry that is then refused, rather than
// letting a command authorized moments earlier commit.
export const reauthorizeActor = async (
  transaction: FirebaseFirestore.Transaction,
  { actorId, claimedRoles, permission }: Actor,
) => authorize(actorId, claimedRoles, permission, await transaction.get(actorRef(actorId)));

// No one performs privileged actions on their own member record.
export const assertNotOwnRecord = (actorId: string, memberId: string | undefined) => {
  if (memberId && memberId === actorId) {
    throw new HttpsError(
      'permission-denied',
      'You cannot perform this action on your own account. Another officer must do it.',
    );
  }
};
