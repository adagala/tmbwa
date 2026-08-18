import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './clientApp';
import {
  KcbPaymentNotification,
  kcbPaymentNotificationSchema,
} from 'tmbwa-shared/firebase';
import { parseDocument } from 'tmbwa-shared';

export type { KcbPaymentNotification } from 'tmbwa-shared/firebase';

export const subscribeToUnresolvedKcbPayments = (
  callback: (items: KcbPaymentNotification[]) => void,
) =>
  onSnapshot(
    query(
      collection(db, 'kcb_payment_notifications'),
      where('status', '==', 'unresolved'),
      orderBy('receivedAt', 'desc'),
    ),
    (snapshot) =>
      callback(
        snapshot.docs.map((item) =>
          parseDocument(
            kcbPaymentNotificationSchema,
            { providerTransactionId: item.id, ...item.data() },
            item.ref.path,
          ),
        ),
      ),
  );

export const reconcileKcbPayment = (data: {
  providerTransactionId: string;
  memberId: string;
  contributionId: string;
}) =>
  httpsCallable(
    functions,
    'reconcileKcbPayment',
  )({ requestId: crypto.randomUUID(), ...data });

export const rejectKcbPayment = (
  providerTransactionId: string,
  reason: string,
) =>
  httpsCallable(
    functions,
    'rejectKcbPayment',
  )({ requestId: crypto.randomUUID(), providerTransactionId, reason });

export const sendKcbDevTillNotification = (amount: number, requestId: string) =>
  httpsCallable(
    functions,
    'sendKcbDevTillNotification',
  )({
    requestId,
    amount,
  });
