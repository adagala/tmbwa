import { collection, onSnapshot, orderBy, query, Timestamp, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './clientApp';

export type KcbPaymentNotification = {
  providerTransactionId: string;
  payerPhone: string;
  payerName: string;
  amount: number;
  currency: string;
  billReference: string;
  transactionDate: string;
  status: 'unresolved' | 'reconciled' | 'rejected';
  suggestedMemberId?: string | null;
  matchReason: string;
  receivedAt?: Timestamp;
};

export const subscribeToUnresolvedKcbPayments = (callback: (items: KcbPaymentNotification[]) => void) =>
  onSnapshot(
    query(collection(db, 'kcb_payment_notifications'), where('status', '==', 'unresolved'), orderBy('receivedAt', 'desc')),
    (snapshot) => callback(snapshot.docs.map((item) => ({
      providerTransactionId: item.id,
      ...item.data(),
    }) as KcbPaymentNotification)),
  );

export const reconcileKcbPayment = (data: { providerTransactionId: string; memberId: string; contributionId: string }) =>
  httpsCallable(functions, 'reconcileKcbPayment')({ requestId: crypto.randomUUID(), ...data });

export const rejectKcbPayment = (providerTransactionId: string, reason: string) =>
  httpsCallable(functions, 'rejectKcbPayment')({ requestId: crypto.randomUUID(), providerTransactionId, reason });
