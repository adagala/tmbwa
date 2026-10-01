import { admin } from '../../firebaseAdmin';
import { describeOfficer, runRolesReadiness } from '../../members/readiness';

admin.initializeApp({ credential: admin.credential.applicationDefault() });

// Readiness check for retiring the legacy `role: administrator`. Once that
// release is deployed, access comes only from the `roles` field and the
// `roles` claim, so it must not be deployed until this reports no blockers.
//
// Read-only by default. --sync-claims syncs the claims of officers whose
// claims do not match their record, from each record as it is at the time of
// writing, without revoking their sessions. It writes the transitional form
// { roles, role }, which both the current and the next release accept, then
// reassesses from fresh state. Officers pick the claims up when their token
// next refreshes (within an hour) or when they sign in again.
//
// in functions directory use like:
//   ~ npm run roles:readiness
//   ~ npm run roles:readiness -- --sync-claims
const SYNC_CLAIMS_FLAG = '--sync-claims';

const rolesReadiness = async () => {
  const { officers, blockers, notes, synced } = await runRolesReadiness({
    syncClaims: process.argv.includes(SYNC_CLAIMS_FLAG),
  });
  synced.forEach((id) => console.log(`Synced claims for ${id}`));
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
    synced.length
      ? 'Ready once synced officers have refreshed their sessions (sign in again, or wait an hour).'
      : 'Ready: no blockers.',
  );
};

rolesReadiness().catch((error) => {
  console.error('rolesReadiness failed:', (error as Error).message);
  process.exitCode = 1;
});
