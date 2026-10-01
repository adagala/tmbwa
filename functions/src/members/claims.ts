import { admin } from '../firebaseAdmin';
import { type Role, legacyRoleFor, memberRoles, sameRoles } from 'tmbwa-shared';

const MAX_SYNC_ATTEMPTS = 5;

// The single path that sets a member's role claims. Claims always come from
// the member record as it is now, never from an event or command result, and
// are written outside any transaction. So a sync that read an older
// assignment cannot leave it in place: after writing, the record is read
// again and the sync repeats until the roles it wrote are still current.
// Every committed role change starts its own sync, so the last sync to
// finish always leaves the latest roles.
export const syncRoleClaims = async (memberId: string): Promise<Role[] | undefined> => {
  const ref = admin.firestore().doc(`members/${memberId}`);
  let snapshot = await ref.get();
  for (let attempt = 0; attempt < MAX_SYNC_ATTEMPTS; attempt += 1) {
    if (!snapshot.exists) return undefined;
    const roles = memberRoles(snapshot.data());
    await admin.auth().setCustomUserClaims(memberId, {
      role: legacyRoleFor(roles),
      roles,
    });
    const latest = await ref.get();
    if (!latest.exists || sameRoles(memberRoles(latest.data()), roles)) return roles;
    snapshot = latest;
  }
  throw new Error(`Roles for member ${memberId} kept changing while their claims were synced.`);
};
