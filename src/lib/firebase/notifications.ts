import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './clientApp';

export type MemberNotification = {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt?: Timestamp;
};

export type NotificationDelivery = {
  id: string;
  memberId: string;
  eventId: string;
  channel: string;
  status: string;
  attempts: number;
  createdAt?: Timestamp;
};

export const subscribeToMemberNotifications = (memberId: string, callback: (items: MemberNotification[]) => void) =>
  onSnapshot(query(collection(db, `members/${memberId}/notifications`), orderBy('createdAt', 'desc'), limit(100)),
    (snapshot) => callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as MemberNotification)));

export const subscribeToNotificationPreference = (memberId: string, callback: (enabled: boolean) => void) =>
  onSnapshot(doc(db, `members/${memberId}/notification_preferences/default`),
    (snapshot) => callback(snapshot.exists() ? snapshot.data().inAppEnabled !== false : true));

export const updateNotificationPreference = (memberId: string, inAppEnabled: boolean) =>
  setDoc(doc(db, `members/${memberId}/notification_preferences/default`), { inAppEnabled, updatedAt: serverTimestamp() }, { merge: true });

export const markNotificationRead = (memberId: string, notificationId: string) =>
  updateDoc(doc(db, `members/${memberId}/notifications/${notificationId}`), { read: true });

export const subscribeToNotificationDeliveries = (callback: (items: NotificationDelivery[]) => void) =>
  onSnapshot(query(collection(db, 'notification_deliveries'), orderBy('createdAt', 'desc'), limit(100)),
    (snapshot) => callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as NotificationDelivery)));

export const retryNotificationDelivery = (deliveryId: string) =>
  httpsCallable(functions, 'retryNotificationDelivery')({ deliveryId });
