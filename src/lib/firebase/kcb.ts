import {
  collection,
  doc,
  getDoc,
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
import { unallocatedPaymentAmount } from 'tmbwa-shared';

export type { KcbPaymentNotification } from 'tmbwa-shared/firebase';

export type AmbiguousKcbStkRequest = {
  requestId: string;
  memberId: string;
  contributionId: string;
  status: 'dispatching' | 'outcome_unknown';
  failureCategory?: string;
};

const pendingRequests = new Map<string, string>();

const call = async (name: string, data: Record<string, unknown>) => {
  const operation = `${name}:${JSON.stringify(data)}`;
  const requestId = pendingRequests.get(operation) ?? crypto.randomUUID();
  pendingRequests.set(operation, requestId);
  try {
    const result = await httpsCallable(functions, name)({ requestId, ...data });
    pendingRequests.delete(operation);
    return result;
  } catch (error) {
    const code = (error as { code?: string }).code ?? '';
    if (
      ![
        'functions/unavailable',
        'functions/deadline-exceeded',
        'functions/internal',
      ].includes(code)
    )
      pendingRequests.delete(operation);
    throw error;
  }
};

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

export const subscribeToKcbPaymentsWithCredit = (
  callback: (items: KcbPaymentNotification[]) => void,
) =>
  onSnapshot(
    query(
      collection(db, 'kcb_payment_notifications'),
      where('status', '==', 'reconciled'),
    ),
    (snapshot) => {
      const notifications = snapshot.docs.map((item) =>
        parseDocument(
          kcbPaymentNotificationSchema,
          { providerTransactionId: item.id, ...item.data() },
          item.ref.path,
        ),
      );
      void Promise.all(
        notifications.map(async (notification) => {
          if (notification.unallocatedAmount !== undefined) return notification;
          if (!notification.memberId || !notification.paymentId)
            return notification;
          const paymentSnapshot = await getDoc(
            doc(
              db,
              `members/${notification.memberId}/payments/${notification.paymentId}`,
            ),
          );
          if (!paymentSnapshot.exists()) return notification;
          const payment = paymentSnapshot.data();
          return {
            ...notification,
            unallocatedAmount: unallocatedPaymentAmount(
              Number(payment.amount),
              Number(payment.contribution_amount),
            ),
          };
        }),
      )
        .then((items) =>
          callback(
            items.filter((item) => Number(item.unallocatedAmount ?? 0) > 0),
          ),
        )
        .catch((error: unknown) => {
          console.error(
            'Could not derive legacy KCB account credit.',
            (error as { code?: string }).code ?? 'unknown',
          );
        });
    },
  );

export const subscribeToAmbiguousKcbStkRequests = (
  callback: (items: AmbiguousKcbStkRequest[]) => void,
) =>
  onSnapshot(
    query(
      collection(db, 'kcb_stk_requests'),
      where('status', 'in', ['dispatching', 'outcome_unknown']),
    ),
    (snapshot) =>
      callback(
        snapshot.docs.flatMap((item) => {
          const data = item.data();
          const status = data.status as 'dispatching' | 'outcome_unknown';
          const failureCategory =
            typeof data.failureCategory === 'string'
              ? data.failureCategory
              : undefined;
          if (
            status === 'outcome_unknown' &&
            (Number(data.resultCode) === 0 ||
              ![
                'provider_outcome_unknown',
                'provider_response_missing_correlation_ids',
              ].includes(failureCategory ?? ''))
          ) {
            return [];
          }
          return [
            {
              requestId: item.id,
              memberId: String(data.memberId ?? ''),
              contributionId: String(data.contributionId ?? ''),
              status,
              ...(failureCategory ? { failureCategory } : {}),
            },
          ];
        }),
      ),
  );

export const reconcileKcbPayment = (data: {
  providerTransactionId: string;
  memberId: string;
  allocations: Array<{ contributionId: string; amount: number }>;
}) => call('reconcileKcbPayment', data);

export const allocateKcbPaymentCredit = (data: {
  providerTransactionId: string;
  allocations: Array<{ contributionId: string; amount: number }>;
}) => call('allocateKcbPaymentCredit', data);

export const requestKcbStkPush = (data: {
  memberId: string;
  contributionId: string;
  amount: number;
}) => call('requestKcbStkPush', data);

export const rejectKcbPayment = (
  providerTransactionId: string,
  reason: string,
) => call('rejectKcbPayment', { providerTransactionId, reason });

export const resolveKcbStkUnknownOutcome = (
  stkRequestId: string,
  reason: string,
) => call('resolveKcbStkUnknownOutcome', { stkRequestId, reason });

export const sendKcbDevTillNotification = (amount: number, requestId: string) =>
  httpsCallable(
    functions,
    'sendKcbDevTillNotification',
  )({
    requestId,
    amount,
  });
