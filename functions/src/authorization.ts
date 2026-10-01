import { admin } from './firebaseAdmin';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  MEMBER_STATUS,
  type Permission,
  type Role,
  roleHasPermission,
  rolesFromClaims,
} from 'tmbwa-shared';

export type CallableAuth = { uid: string; token: Record<string, unknown> } | undefined;

export type Actor = { actorId: string; actorRoles: Role[] };

// Admin SDK writes bypass Firestore rules, so every privileged callable must
// pass through this check. It confirms the permission and that the actor's
// member record is still active: a suspended or inactive member keeps their
// claims until their token expires, but loses access immediately here.
export const requirePermission = async (
  auth: CallableAuth,
  permission: Permission,
): Promise<Actor> => {
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in is required.');
  const actorRoles = rolesFromClaims(auth.token);
  if (!roleHasPermission(actorRoles, permission)) {
    throw new HttpsError('permission-denied', 'You do not have permission to perform this action.');
  }
  const actor = await admin.firestore().doc(`members/${auth.uid}`).get();
  if (actor.get('status') !== MEMBER_STATUS.ACTIVE) {
    throw new HttpsError('permission-denied', 'Your account is not active.');
  }
  return { actorId: auth.uid, actorRoles };
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
