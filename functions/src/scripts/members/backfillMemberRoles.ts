import { admin } from '../../firebaseAdmin';
import { legacyRoleFor, memberRoles } from 'tmbwa-shared';

admin.initializeApp({ credential: admin.credential.applicationDefault() });

// Sets the server-owned `roles` field on members that predate it, derived from
// the legacy `role` field: administrator -> [member, super_admin], anything
// else -> [member]. Effective roles do not change, so custom claims and
// sessions are left alone.
//
// Dry run by default; nothing is written without --apply. Safe to re-run:
// members that already have `roles` are skipped. Only `roles` and
// `rolesBackfilledAt` are written; no financial or personal field is touched.
//
// in functions directory use like:
//   ~ npm run backfill:member-roles             (dry run)
//   ~ npm run backfill:member-roles -- --apply
const APPLY_FLAG = '--apply';
const KNOWN_LEGACY_ROLES = ['member', 'administrator'];

const backfillMemberRoles = async () => {
  const apply = process.argv.includes(APPLY_FLAG);
  const firestore = admin.firestore();
  const snapshot = await firestore.collection('members').get();

  const pending = snapshot.docs.filter((doc) => !Array.isArray(doc.get('roles')));
  const unknownLegacy = pending.filter(
    (doc) => !KNOWN_LEGACY_ROLES.includes(doc.get('role')),
  );
  const inconsistent = snapshot.docs.filter(
    (doc) =>
      Array.isArray(doc.get('roles')) &&
      doc.get('role') !== legacyRoleFor(memberRoles(doc.data())),
  );

  console.log(`${apply ? 'Applying' : 'Dry run:'} ${pending.length} of ${snapshot.size} member(s) need roles.`);
  pending.forEach((doc) => {
    console.log(`${doc.id}: role ${JSON.stringify(doc.get('role') ?? null)} -> ${JSON.stringify(memberRoles(doc.data()))}`);
  });
  unknownLegacy.forEach((doc) => {
    console.warn(`${doc.id}: unrecognised legacy role ${JSON.stringify(doc.get('role') ?? null)}; treated as member.`);
  });
  inconsistent.forEach((doc) => {
    console.warn(`${doc.id}: legacy role ${JSON.stringify(doc.get('role') ?? null)} does not match roles ${JSON.stringify(doc.get('roles'))}; not changed, review manually.`);
  });
  if (!apply || !pending.length) return;

  let written = 0;
  for (const doc of pending) {
    const outcome = await firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(doc.ref);
      if (!current.exists) return 'deleted';
      if (Array.isArray(current.get('roles'))) return 'already set';
      transaction.update(doc.ref, {
        roles: memberRoles(current.data()),
        rolesBackfilledAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return 'written';
    });
    if (outcome === 'written') written += 1;
    console.log(`${doc.id}: ${outcome}`);
  }
  console.log(`Backfilled roles on ${written} member(s).`);
};

backfillMemberRoles()
  .then(() => console.log('DONE'))
  .catch((error) => {
    console.error('backfillMemberRoles failed:', (error as Error).message);
    process.exitCode = 1;
  });
