import { UserRecord } from 'firebase-admin/auth';
import { ROLE } from 'tmbwa-shared';
import { admin } from '../../firebaseAdmin';
import { arrayToChunks } from '../../utils';
import { assessRolesReadiness, describeOfficer } from '../../members/readiness';

admin.initializeApp({ credential: admin.credential.applicationDefault() });

// Readiness check for retiring the legacy `role: administrator`. Once that
// release is deployed, access comes only from the `roles` field and the
// `roles` claim, so it must not be deployed until this reports no blockers.
//
// Read-only by default. --sync-claims sets the claims of officers whose
// claims do not match their record, without revoking their sessions. It
// writes the transitional form { roles, role }, which both the current and
// the next release accept; officers pick it up when their token next
// refreshes (within an hour) or when they sign in again.
//
// in functions directory use like:
//   ~ npm run roles:readiness
//   ~ npm run roles:readiness -- --sync-claims
const SYNC_CLAIMS_FLAG = '--sync-claims';

const rolesReadiness = async () => {
  const syncClaims = process.argv.includes(SYNC_CLAIMS_FLAG);
  const snapshot = await admin.firestore().collection('members').get();
  const users = new Map<string, UserRecord>();
  for (const chunk of arrayToChunks(snapshot.docs, 100)) {
    const result = await admin.auth().getUsers(chunk.map((doc) => ({ uid: doc.id })));
    result.users.forEach((user) => users.set(user.uid, user));
  }

  const { officers, staleClaims, blockers, notes } = assessRolesReadiness(
    snapshot.docs.map((doc) => ({
      id: doc.id,
      data: doc.data(),
      claims: users.has(doc.id) ? (users.get(doc.id)?.customClaims ?? null) : undefined,
    })),
  );

  if (syncClaims) {
    for (const officer of staleClaims) {
      await admin.auth().setCustomUserClaims(officer.id, {
        roles: officer.roles,
        // Transitional: the release before this one still reads `role`.
        role: officer.roles.includes(ROLE.SUPER_ADMIN) ? 'administrator' : 'member',
      });
      console.log(`Synced claims for ${describeOfficer(officer)}`);
    }
  } else {
    staleClaims.forEach((officer) =>
      blockers.push(`${describeOfficer(officer)}: claims do not carry these roles; run with ${SYNC_CLAIMS_FLAG}.`));
  }

  console.log(`Officers (${officers.length}):`);
  officers.forEach((officer) => console.log(`  ${describeOfficer(officer)}`));
  notes.forEach((note) => console.log(`Note: ${note}`));
  if (blockers.length) {
    blockers.forEach((blocker) => console.error(`Blocker: ${blocker}`));
    console.error(`Not ready: ${blockers.length} blocker(s).`);
    process.exitCode = 1;
    return;
  }
  console.log(
    syncClaims && staleClaims.length
      ? 'Ready once synced officers have refreshed their sessions (sign in again, or wait an hour).'
      : 'Ready: no blockers.',
  );
};

rolesReadiness().catch((error) => {
  console.error('rolesReadiness failed:', (error as Error).message);
  process.exitCode = 1;
});
