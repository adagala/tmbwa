import { admin } from '../../firebaseAdmin';
import {
  paymentReferenceNormalized,
  referenceNormalizedChange,
  sharedReferences,
} from '../../payments/reference';

const projectId = process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId) throw new Error('Set GOOGLE_CLOUD_PROJECT to the target project.');
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
console.log(`Target project: ${projectId}${process.env.FIRESTORE_EMULATOR_HOST ? ' (EMULATOR)' : ''}`);

// Sets the server-owned `referenceNormalized` field, the M-Pesa code in
// `referencenumber` normalized the way KCB statements report receipts, on
// member payments written before the payment writers kept it (#94). Deploy
// Functions first so payments created during the run already carry it.
//
// Dry run by default; nothing is written without --apply. Safe to re-run:
// each payment is re-read in a transaction and written only when the stored
// value differs. Only `referenceNormalized` and
// `referenceNormalizedBackfilledAt` are written; a reference that is not an
// M-Pesa code removes `referenceNormalized`. References, names and phones are
// never printed: only document paths and counts.
//
// The report also lists normalized references shared by several payments and
// contributions whose embedded payments have no payment document, since a
// statement import cannot match those automatically.
//
// The target project must be named; it is never inferred from gcloud.
// in functions directory use like:
//   ~ export GOOGLE_APPLICATION_CREDENTIALS=src/serviceAccountDevelopment.json
//   ~ export GOOGLE_CLOUD_PROJECT=the-midbar-welfare-dev
//   ~ npm run backfill:payment-reference-normalized             (dry run)
//   ~ npm run backfill:payment-reference-normalized -- --apply
const APPLY_FLAG = '--apply';
const PAGE_SIZE = 500;
const WRITE_CONCURRENCY = 50;

const readCollectionGroup = async (collectionId: string) => {
  const firestore = admin.firestore();
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let query = firestore.collectionGroup(collectionId)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (last) query = query.startAfter(last);
    const page = await query.get();
    docs.push(...page.docs);
    if (page.size < PAGE_SIZE) return docs;
    last = page.docs[page.docs.length - 1];
  }
};

// Only `members/{memberId}/payments/{paymentId}` documents are member payments.
const isMemberPayment = (doc: FirebaseFirestore.QueryDocumentSnapshot) =>
  doc.ref.parent.parent?.parent.id === 'members';

const backfillPaymentReferenceNormalized = async () => {
  const apply = process.argv.includes(APPLY_FLAG);
  const payments = (await readCollectionGroup('payments')).filter(isMemberPayment);
  const contributions = await readCollectionGroup('contributions');

  const pending = payments.filter((doc) => referenceNormalizedChange(doc.data()));
  const toSet = pending.filter((doc) => referenceNormalizedChange(doc.data())?.action === 'set');
  const balanceForward = payments.filter((doc) => doc.get('referencenumber') === 'BALANCE B/F');
  const notReceipts = payments.filter((doc) =>
    !paymentReferenceNormalized(doc.data()) && doc.get('referencenumber') !== 'BALANCE B/F');
  const shared = sharedReferences(payments.map((doc) => ({
    path: doc.ref.path,
    referenceNormalized: paymentReferenceNormalized(doc.data()),
  })));

  const paymentPaths = new Set(payments.map((doc) => doc.ref.path));
  const orphaned = contributions.flatMap((doc) => {
    const memberRef = doc.ref.parent.parent;
    const embedded = doc.get('payments');
    if (!memberRef || !Array.isArray(embedded)) return [];
    const missing = embedded.filter((payment) =>
      typeof payment?.payment_id === 'string' &&
      !paymentPaths.has(`${memberRef.path}/payments/${payment.payment_id}`)).length;
    return missing ? [{ path: doc.ref.path, missing }] : [];
  });

  console.log(`${apply ? 'Applying' : 'Dry run:'} ${pending.length} of ${payments.length} payment(s) need referenceNormalized.`);
  // A statement receipt matching one of these is flagged for the treasurer.
  shared.forEach((paths, index) => {
    console.warn(`Shared reference ${index + 1}: ${paths.join(', ')}`);
  });
  // A statement import looks payments up by document, so these are invisible to it.
  orphaned.forEach(({ path, missing }) => {
    console.warn(`${path}: ${missing} embedded payment(s) without a payment document.`);
  });

  let updated = 0;
  if (apply) {
    const firestore = admin.firestore();
    for (let start = 0; start < pending.length; start += WRITE_CONCURRENCY) {
      const outcomes = await Promise.all(pending.slice(start, start + WRITE_CONCURRENCY).map((doc) =>
        firestore.runTransaction(async (transaction) => {
          const current = await transaction.get(doc.ref);
          if (!current.exists) return 'deleted';
          const change = referenceNormalizedChange(current.data());
          if (!change) return 'already current';
          transaction.update(doc.ref, {
            referenceNormalized: change.action === 'set' ?
              change.value :
              admin.firestore.FieldValue.delete(),
            referenceNormalizedBackfilledAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          return change.action === 'set' ? 'written' : 'removed';
        }).then((outcome) => {
          console.log(`${doc.ref.path}: ${outcome}`);
          return outcome;
        })));
      updated += outcomes.filter((outcome) => outcome === 'written' || outcome === 'removed').length;
    }
  }

  console.log([
    `Payments: ${payments.length}`,
    `${apply ? 'Updated' : 'To update'}: ${apply ? updated : pending.length}` +
      ` (set ${toSet.length}, remove ${pending.length - toSet.length})`,
    `Unchanged: ${payments.length - pending.length}`,
    `BALANCE B/F: ${balanceForward.length}`,
    `Other references that are not M-Pesa codes: ${notReceipts.length}`,
    `Shared: ${shared.length} reference(s) across ${shared.reduce((total, paths) => total + paths.length, 0)} payment(s)`,
    `Contributions with embedded payments missing a payment document: ${orphaned.length}` +
      ` (${orphaned.reduce((total, item) => total + item.missing, 0)} payment(s))`,
  ].join('\n'));
};

backfillPaymentReferenceNormalized()
  .then(() => console.log('DONE'))
  .catch((error) => {
    console.error('backfillPaymentReferenceNormalized failed:', (error as Error).message);
    process.exitCode = 1;
  });
