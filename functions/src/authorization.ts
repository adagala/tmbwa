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

export type Actor = { actorId: string; actorRoles: Role[] };

const actorRef = (actorId: string) => admin.firestore().doc(`members/${actorId}`);

const assertActive = (actor: FirebaseFirestore.DocumentSnapshot) => {
  if (actor.get('status') !== MEMBER_STATUS.ACTIVE) {
    throw new HttpsError('permission-denied', 'Your account is not active.');
  }
};

const permissionDenied = () =>
  new HttpsError('permission-denied', 'You do not have permission to perform this action.');

// Admin SDK writes bypass Firestore rules, so every privileged callable must
// pass through this check. A role counts only when both the caller's token and
// their member record grant it: the token lags behind a revocation until it
// expires, the record does not. The record must also still be active.
export const requirePermission = async (
  auth: CallableAuth,
  permission: Permission,
): Promise<Actor> => {
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in is required.');
  const claimedRoles = rolesFromClaims(auth.token);
  if (!roleHasPermission(claimedRoles, permission)) throw permissionDenied();
  const actor = await actorRef(auth.uid).get();
  assertActive(actor);
  const recordRoles = memberRoles(actor.data());
  const actorRoles = claimedRoles.filter((role) => recordRoles.includes(role));
  if (!roleHasPermission(actorRoles, permission)) throw permissionDenied();
  return { actorId: auth.uid, actorRoles };
};

// Privileged mutations must also call this first inside their transaction.
// Reading the actor there puts their member record in the transaction's read
// set, so a concurrent suspension forces a retry that is then refused, rather
// than letting a command authorized moments earlier commit. Commands that
// change authorization itself also pass the permission, so a concurrent role
// revocation is refused the same way.
export const assertActorActive = async (
  transaction: FirebaseFirestore.Transaction,
  actorId: string,
  permission?: Permission,
) => {
  const actor = await transaction.get(actorRef(actorId));
  assertActive(actor);
  if (permission && !roleHasPermission(memberRoles(actor.data()), permission)) {
    throw permissionDenied();
  }
};

// No one performs privileged actions on their own member record.
export const assertNotOwnRecord = (actorId: string, memberId: string | undefined) => {
  if (memberId && memberId === actorId) {
    throw new HttpsError(
      'permission-denied',
      'You cannot perform this action on your own account. Another officer must do it.',
    );
  }
};
