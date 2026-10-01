import { UserRecord } from 'firebase-admin/auth';
import { memberRoles, normalizeRoles, rolesFromClaims, sameRoles } from 'tmbwa-shared';
import { admin } from '../firebaseAdmin';
import { arrayToChunks } from '../utils';
import { legacyRoleValue, syncRoleClaims, transitionalClaims } from './claims';

export type LegacyRestore = {
  // Members whose record lacks the matching retired `role` field.
  fields: string[];
  // Members whose claims lack the matching retired `role` claim or roles.
  claims: string[];
};

// Rollback repair for the release that retired the legacy administrator role.
// The release before it requires a `role` field on every member record (its
// schemas refuse records without one) and waits on the `role` claim to load
// its screens. Members created or reassigned since have neither, so this
// restores both from each member's current `roles` before that release is
// redeployed. Records are rechecked inside a transaction and claims go
// through syncRoleClaims, so concurrent role changes are never overwritten
// with stale values. Dry run unless apply is set; safe to re-run.
export const restoreLegacyRoleFields = async ({ apply }: { apply: boolean }): Promise<LegacyRestore> => {
  const firestore = admin.firestore();
  const snapshot = await firestore.collection('members').get();
  const users = new Map<string, UserRecord>();
  for (const chunk of arrayToChunks(snapshot.docs, 100)) {
    const result = await admin.auth().getUsers(chunk.map((doc) => ({ uid: doc.id })));
    result.users.forEach((user) => users.set(user.uid, user));
  }

  const fields = snapshot.docs
    .filter((doc) => doc.get('role') !== legacyRoleValue(memberRoles(doc.data())))
    .map((doc) => doc.id);
  const claims = snapshot.docs
    .filter((doc) => {
      const user = users.get(doc.id);
      if (!user) return false;
      const roles = memberRoles(doc.data());
      return user.customClaims?.role !== legacyRoleValue(roles) ||
        !sameRoles(normalizeRoles(rolesFromClaims(user.customClaims)), roles);
    })
    .map((doc) => doc.id);
  if (!apply) return { fields, claims };

  for (const id of fields) {
    const ref = firestore.doc(`members/${id}`);
    await firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      if (!current.exists) return;
      const role = legacyRoleValue(memberRoles(current.data()));
      // Only the retired field; effective roles are unchanged, so the member
      // triggers leave claims alone.
      if (current.get('role') !== role) transaction.update(ref, { role });
    });
  }
  for (const id of claims) await syncRoleClaims(id, transitionalClaims);
  return { fields, claims };
};
