import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './clientApp';
import {
  MemberNotification,
  NotificationDelivery,
  memberNotificationSchema,
  notificationDeliverySchema,
  notificationPreferenceSchema,
} from 'tmbwa-shared/firebase';
import { parseDocument } from 'tmbwa-shared';

export type { MemberNotification, NotificationDelivery } from 'tmbwa-shared/firebase';

export const subscribeToMemberNotifications = (memberId: string, callback: (items: MemberNotification[]) => void) =>
  onSnapshot(query(collection(db, `members/${memberId}/notifications`), orderBy('createdAt', 'desc'), limit(100)),
    (snapshot) => callback(snapshot.docs.map((item) => parseDocument(
      memberNotificationSchema,
      { id: item.id, ...item.data() },
      item.ref.path,
    ))));

export const subscribeToNotificationPreference = (memberId: string, callback: (enabled: boolean) => void) =>
  onSnapshot(doc(db, `members/${memberId}/notification_preferences/default`),
    (snapshot) => callback(snapshot.exists()
      ? parseDocument(notificationPreferenceSchema, snapshot.data(), snapshot.ref.path).inAppEnabled
      : true));

export const updateNotificationPreference = (memberId: string, inAppEnabled: boolean) =>
  setDoc(
    doc(db, `members/${memberId}/notification_preferences/default`),
    notificationPreferenceSchema.parse({ inAppEnabled, updatedAt: serverTimestamp() }),
    { merge: true },
  );

export const markNotificationRead = (memberId: string, notificationId: string) =>
  updateDoc(doc(db, `members/${memberId}/notifications/${notificationId}`), { read: true });

export const subscribeToNotificationDeliveries = (callback: (items: NotificationDelivery[]) => void) =>
  onSnapshot(query(collection(db, 'notification_deliveries'), orderBy('createdAt', 'desc'), limit(100)),
    (snapshot) => callback(snapshot.docs.map((item) => parseDocument(
      notificationDeliverySchema,
      { id: item.id, ...item.data() },
      item.ref.path,
    ))));

export const retryNotificationDelivery = (deliveryId: string) =>
  httpsCallable(functions, 'retryNotificationDelivery')({ deliveryId });
