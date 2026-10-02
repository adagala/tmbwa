import { admin } from '../../firebaseAdmin';
import { phoneNormalizedChange, profilePhoneNormalized } from '../../members/phone';

const projectId = process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId) throw new Error('Set GOOGLE_CLOUD_PROJECT to the target project.');
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
console.log(`Target project: ${projectId}${process.env.FIRESTORE_EMULATOR_HOST ? ' (EMULATOR)' : ''}`);

// make sure to set the below per session
// GOOGLE_APPLICATION_CREDENTIALS=src/serviceAccountDevelopment.json
// GOOGLE_CLOUD_PROJECT=the-midbar-welfare-dev

// Sets the server-owned `phoneNormalized` field, the copy of `phonenumber`
// that KCB Till notifications are matched on, for members created before the
// member triggers kept it. Deploy Functions first so members edited during
// the run are kept current by the triggers.
//
// Dry run by default; nothing is written without --apply. Safe to re-run:
// each member is re-read in a transaction and written only when the stored
// value differs. Only `phoneNormalized` and `phoneNormalizedBackfilledAt` are
// written; an invalid number removes `phoneNormalized`. Phone numbers are
// never printed: only member IDs and counts.
//
// The target project must be named; it is never inferred from gcloud.
// in functions directory use like:
//   ~ export GOOGLE_APPLICATION_CREDENTIALS=src/serviceAccountDevelopment.json
//   ~ export GOOGLE_CLOUD_PROJECT=the-midbar-welfare-dev
//   ~ npm run backfill:member-phone-normalized             (dry run)
//   ~ npm run backfill:member-phone-normalized -- --apply
const APPLY_FLAG = '--apply';

const backfillMemberPhoneNormalized = async () => {
  const apply = process.argv.includes(APPLY_FLAG);
  const firestore = admin.firestore();
  const snapshot = await firestore.collection('members').get();

  const invalid = snapshot.docs.filter(
    (doc) => !profilePhoneNormalized(doc.get('phonenumber')),
  );
  const pending = snapshot.docs.filter((doc) => phoneNormalizedChange(doc.data()));

  const membersByPhone = new Map<string, string[]>();
  snapshot.docs.forEach((doc) => {
    const phone = profilePhoneNormalized(doc.get('phonenumber'));
    if (phone) membersByPhone.set(phone, [...(membersByPhone.get(phone) ?? []), doc.id]);
  });
  const shared = [...membersByPhone.values()].filter((ids) => ids.length > 1);

  console.log(`${apply ? 'Applying' : 'Dry run:'} ${pending.length} of ${snapshot.size} member(s) need phoneNormalized.`);
  invalid.forEach((doc) => {
    console.warn(`${doc.id}: phone number is not a valid Kenyan mobile; phoneNormalized stays unset.`);
  });
  // Till payments from a shared number get no suggested member.
  shared.forEach((ids, index) => {
    console.warn(`Shared number ${index + 1}: members ${ids.join(', ')}.`);
  });

  let updated = 0;
  if (apply) {
    for (const doc of pending) {
      const outcome = await firestore.runTransaction(async (transaction) => {
        const current = await transaction.get(doc.ref);
        if (!current.exists) return 'deleted';
        const change = phoneNormalizedChange(current.data());
        if (!change) return 'already current';
        transaction.update(doc.ref, {
          phoneNormalized: change.action === 'set' ?
            change.value :
            admin.firestore.FieldValue.delete(),
          phoneNormalizedBackfilledAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return change.action === 'set' ? 'written' : 'removed';
      });
      if (outcome === 'written' || outcome === 'removed') updated += 1;
      console.log(`${doc.id}: ${outcome}`);
    }
  }

  console.log([
    `Members: ${snapshot.size}`,
    `${apply ? 'Updated' : 'To update'}: ${apply ? updated : pending.length}`,
    `Unchanged: ${snapshot.size - pending.length}`,
    `Invalid: ${invalid.length}`,
    `Duplicate: ${shared.length} shared number(s) across ${shared.reduce((total, ids) => total + ids.length, 0)} member(s)`,
  ].join('\n'));
};

backfillMemberPhoneNormalized()
  .then(() => console.log('DONE'))
  .catch((error) => {
    console.error('backfillMemberPhoneNormalized failed:', (error as Error).message);
    process.exitCode = 1;
  });
