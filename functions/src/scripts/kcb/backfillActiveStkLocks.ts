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

  for (const plan of plans) {
    const result = await firestore.runTransaction(async (transaction) => {
      const [currentRequestSnapshot, currentLock] = await Promise.all([
        transaction.get(plan.requestSnapshot.ref),
        transaction.get(plan.lockRef),
      ]);
      if (!currentRequestSnapshot.exists) return 'request deleted';
      const currentRequest = kcbStkRequestData(currentRequestSnapshot);
      const currentLockData = currentLock.data();
      const currentLockIsActive =
        typeof currentLockData?.status === 'string' &&
        isActiveStkRequestStatus(currentLockData.status);
      if (!isActiveStkRequestStatus(currentRequest.status)) {
        if (
          currentLockIsActive &&
          currentLockData?.requestId === currentRequestSnapshot.id
        ) {
          transaction.update(plan.lockRef, {
            status: currentRequest.status,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            migrationBackfilledAt:
              admin.firestore.FieldValue.serverTimestamp(),
          });
          return `terminal (${currentRequest.status}); stale lock released`;
        }
        return `terminal (${currentRequest.status}); skipped`;
      }
      if (
        currentLockIsActive &&
        currentLockData?.requestId !== currentRequestSnapshot.id
      ) {
        throw new Error(
          `Refusing migration: ${plan.lockRef.path} became owned by ${String(currentLockData?.requestId)} instead of ${currentRequestSnapshot.id}.`,
        );
      }
      const leaseExpiresAt =
        currentRequest.status === 'initiating'
          ? (currentRequest.leaseExpiresAt ??
            admin.firestore.Timestamp.fromMillis(Date.now() - 1))
          : undefined;
      if (
        currentRequest.status === 'initiating' &&
        !currentRequest.leaseExpiresAt
      ) {
        transaction.update(currentRequestSnapshot.ref, {
          leaseExpiresAt,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      transaction.set(
        plan.lockRef,
        {
          requestId: currentRequestSnapshot.id,
          status: currentRequest.status,
          amount: Number(currentRequest.amount),
          ...(leaseExpiresAt ? { leaseExpiresAt } : {}),
          ...(currentRequest.dispatchExpiresAt
            ? { dispatchExpiresAt: currentRequest.dispatchExpiresAt }
            : {}),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          migrationBackfilledAt:
            admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return `active (${currentRequest.status}); lock ensured`;
    });
    console.log(`${plan.requestSnapshot.id}: ${result}`);
  }
};

backfillActiveStkLocks()
  .then(() => console.log('STK lock backfill complete.'))
  .catch((error: unknown) => {
    console.error('STK lock backfill failed.', error);
    process.exitCode = 1;
  });
