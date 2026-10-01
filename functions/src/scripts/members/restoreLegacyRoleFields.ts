import { admin } from '../../firebaseAdmin';
import { restoreLegacyRoleFields } from '../../members/rollback';

admin.initializeApp({ credential: admin.credential.applicationDefault() });

// Rollback repair: run before redeploying the release that still requires the
// retired `role` field and claim (Roles 3/4, #79). Restores both from each
// member's current roles; see docs/authorization.md. Pause role changes until
// the previous release is deployed.
//
// in functions directory use like:
//   ~ npm run roles:restore-legacy             (dry run)
//   ~ npm run roles:restore-legacy -- --apply
const APPLY_FLAG = '--apply';

const run = async () => {
  const apply = process.argv.includes(APPLY_FLAG);
  const { fields, claims } = await restoreLegacyRoleFields({ apply });
  console.log(`${apply ? 'Restored' : 'Dry run: would restore'} the role field on ${fields.length} member(s).`);
  fields.forEach((id) => console.log(`  field: ${id}`));
  console.log(`${apply ? 'Restored' : 'Dry run: would restore'} the role claim for ${claims.length} member(s).`);
  claims.forEach((id) => console.log(`  claims: ${id}`));
};

run().catch((error) => {
  console.error('restoreLegacyRoleFields failed:', (error as Error).message);
  process.exitCode = 1;
});
