import * as admin from 'firebase-admin';
import { isActiveStkRequestStatus } from '../../kcb/domain';
import { kcbStkRequestData } from '../../firestoreData';

admin.initializeApp({ credential: admin.credential.applicationDefault() });

const APPLY_FLAG = '--apply';
const activeStatuses = [
  'initiating',
  'dispatching',
  'outcome_unknown',
  'pending',
  'succeeded_pending_reconciliation',
];

const backfillActiveStkLocks = async () => {
  const apply = process.argv.includes(APPLY_FLAG);
  const firestore = admin.firestore();
  const activeRequests = await firestore
    .collection('kcb_stk_requests')
    .where('status', 'in', activeStatuses)
    .get();
  const groups = new Map<
    string,
    Array<FirebaseFirestore.QueryDocumentSnapshot>
  >();

  activeRequests.docs.forEach((snapshot) => {
    const request = kcbStkRequestData(snapshot);
    if (!isActiveStkRequestStatus(request.status)) return;
    const key = `${request.memberId}/${request.contributionId}`;
    groups.set(key, [...(groups.get(key) ?? []), snapshot]);
  });

  const duplicateGroups = [...groups.entries()].filter(
    ([, requests]) => requests.length > 1,
  );
  if (duplicateGroups.length) {
    throw new Error(
      `Refusing migration: multiple active STK requests exist for ${duplicateGroups
        .map(([key]) => key)
        .join(', ')}.`,
    );
  }

  const plans = await Promise.all(
    [...groups.values()].map(async ([requestSnapshot]) => {
      const request = kcbStkRequestData(requestSnapshot);
      const lockRef = firestore.doc(
        `members/${request.memberId}/contributions/${request.contributionId}/payment_locks/stk`,
      );
      const lock = await lockRef.get();
      const lockData = lock.data();
      if (
        lock.exists &&
        typeof lockData?.status === 'string' &&
        isActiveStkRequestStatus(lockData.status) &&
        lockData.requestId !== requestSnapshot.id
      ) {
        throw new Error(
          `Refusing migration: ${lockRef.path} is owned by ${String(lockData.requestId)} instead of ${requestSnapshot.id}.`,
        );
      }
      const leaseExpiresAt =
        request.status === 'initiating'
          ? (request.leaseExpiresAt ??
            admin.firestore.Timestamp.fromMillis(Date.now() - 1))
          : undefined;
      return { requestSnapshot, request, lockRef, leaseExpiresAt };
    }),
  );

  console.log(
    `${apply ? 'Applying' : 'Dry run:'} ${plans.length} active STK lock backfill(s).`,
  );
  plans.forEach(({ requestSnapshot, lockRef, leaseExpiresAt }) => {
    console.log(
      `${requestSnapshot.id} -> ${lockRef.path}${leaseExpiresAt ? ' (recovery lease ensured)' : ''}`,
    );
  });
  if (!apply || !plans.length) return;

  for (let offset = 0; offset < plans.length; offset += 200) {
    const batch = firestore.batch();
    plans.slice(offset, offset + 200).forEach((plan) => {
      if (
        plan.request.status === 'initiating' &&
        !plan.request.leaseExpiresAt
      ) {
        batch.update(plan.requestSnapshot.ref, {
          leaseExpiresAt: plan.leaseExpiresAt,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      batch.set(
        plan.lockRef,
        {
          requestId: plan.requestSnapshot.id,
          status: plan.request.status,
          amount: Number(plan.request.amount),
          ...(plan.leaseExpiresAt
            ? { leaseExpiresAt: plan.leaseExpiresAt }
            : {}),
          ...(plan.request.dispatchExpiresAt
            ? { dispatchExpiresAt: plan.request.dispatchExpiresAt }
            : {}),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          migrationBackfilledAt:
            admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });
    await batch.commit();
  }
};

backfillActiveStkLocks()
  .then(() => console.log('STK lock backfill complete.'))
  .catch((error: unknown) => {
    console.error('STK lock backfill failed.', error);
    process.exitCode = 1;
  });
