import { admin } from '../firebaseAdmin';
import { ROLE, type Role, memberRoles, sameRoles } from 'tmbwa-shared';

const MAX_SYNC_ATTEMPTS = 5;

// The single path that sets a member's role claims. Claims always come from
// the member record as it is now, never from an event or command result, and
// are written outside any transaction. So a sync that read an older
// assignment cannot leave it in place: after writing, the record is read
// again and the sync repeats until the roles it wrote are still current.
// Every committed role change starts its own sync, so the last sync to
// finish always leaves the latest roles.
//
// Maintenance scripts that bridge releases pass transitionalClaims to also
// write the retired `role` claim that the previous release still reads.
export const syncRoleClaims = async (
  memberId: string,
  claimsFor: (roles: Role[]) => Record<string, unknown> = (roles) => ({ roles }),
): Promise<Role[] | undefined> => {
  const ref = admin.firestore().doc(`members/${memberId}`);
  let snapshot = await ref.get();
  for (let attempt = 0; attempt < MAX_SYNC_ATTEMPTS; attempt += 1) {
    if (!snapshot.exists) return undefined;
    const roles = memberRoles(snapshot.data());
    // Replaces every claim, so by default it also drops the retired `role`.
    await admin.auth().setCustomUserClaims(memberId, claimsFor(roles));
    const latest = await ref.get();
    if (!latest.exists || sameRoles(memberRoles(latest.data()), roles)) return roles;
    snapshot = latest;
  }
  throw new Error(`Roles for member ${memberId} kept changing while their claims were synced.`);
};

// The single `role` value the release before roles-only access reads from
// claims and member records.
export const legacyRoleValue = (roles: readonly Role[]) =>
  roles.includes(ROLE.SUPER_ADMIN) ? 'administrator' : 'member';

// Claims both that release and this one accept.
export const transitionalClaims = (roles: Role[]) => ({ roles, role: legacyRoleValue(roles) });
