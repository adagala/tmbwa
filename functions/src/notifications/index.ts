import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { nextAttemptDelayMs, NotificationEvent, renderNotification } from './domain';

type Data = Record<string, unknown>;
const db = () => admin.firestore();

const requireAdministrator = (auth: { uid: string; token: Record<string, unknown> } | undefined) => {
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in is required.');
  if (auth.token.role !== 'administrator') throw new HttpsError('permission-denied', 'Administrator access is required.');
  return auth.uid;
};

export const queueNotificationDeliveries = onDocumentCreated('notification_events/{eventId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;
  const notification = snapshot.data();
  const memberId = typeof notification.memberId === 'string' ? notification.memberId : '';
  if (!memberId) {
    logger.warn('Notification event is missing memberId.', { eventId: event.params.eventId });
    return;
  }
  const preferences = await db().doc(`members/${memberId}/notification_preferences/default`).get();
  if (preferences.exists && preferences.data()?.inAppEnabled === false) return;
  const deliveryRef = db().doc(`notification_deliveries/${event.params.eventId}-in_app`);
  try {
    await deliveryRef.create({
      eventId: event.params.eventId, memberId, channel: 'in_app', status: 'pending', attempts: 0,
      nextAttemptAt: admin.firestore.Timestamp.now(), createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 6) throw error;
  }
});

const deliver = async (delivery: FirebaseFirestore.QueryDocumentSnapshot) => {
  const data = delivery.data();
  const eventSnapshot = await db().doc(`notification_events/${data.eventId}`).get();
  if (!eventSnapshot.exists) throw new Error('Notification event not found.');
  const event = eventSnapshot.data() as NotificationEvent & Data;
  const message = renderNotification(event);
  await db().runTransaction(async (transaction) => {
    const current = await transaction.get(delivery.ref);
    if (!current.exists || current.data()?.status !== 'pending') return;
    transaction.create(db().doc(`members/${data.memberId}/notifications/${delivery.id}`), {
      eventId: data.eventId, channel: data.channel, ...message, read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.update(delivery.ref, {
      status: 'delivered', providerReference: delivery.id,
      deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
      attempts: admin.firestore.FieldValue.increment(1),
    });
  });
};

export const processNotificationOutbox = onSchedule('every 5 minutes', async () => {
  const now = admin.firestore.Timestamp.now();
  const pending = await db().collection('notification_deliveries')
    .where('status', '==', 'pending').where('nextAttemptAt', '<=', now).limit(100).get();
  await Promise.all(pending.docs.map(async (delivery) => {
    try {
      await deliver(delivery);
    } catch (error) {
      const attempts = Number(delivery.data().attempts ?? 0) + 1;
      const deadLetter = attempts >= 5;
      await delivery.ref.update({
        status: deadLetter ? 'dead_letter' : 'pending', attempts,
        failureCategory: 'delivery_error',
        nextAttemptAt: admin.firestore.Timestamp.fromMillis(Date.now() + nextAttemptDelayMs(attempts)),
        lastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      logger.error('Notification delivery failed.', { deliveryId: delivery.id, attempts, reason: (error as Error).message });
    }
  }));
});

export const retryNotificationDelivery = onCall(async (request) => {
  const actorId = requireAdministrator(request.auth);
  const data = request.data as Data;
  const deliveryId = typeof data.deliveryId === 'string' ? data.deliveryId.trim() : '';
  if (!deliveryId) throw new HttpsError('invalid-argument', 'deliveryId is required.');
  const ref = db().doc(`notification_deliveries/${deliveryId}`);
  await db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new HttpsError('not-found', 'Delivery not found.');
    if (!['failed', 'dead_letter'].includes(String(snapshot.data()?.status))) {
      throw new HttpsError('failed-precondition', 'Only failed deliveries can be retried.');
    }
    transaction.update(ref, {
      status: 'pending', nextAttemptAt: admin.firestore.Timestamp.now(),
      retriedBy: actorId, retriedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
  return { deliveryId, status: 'pending' };
});

export const generateContributionReminders = onSchedule({ schedule: '0 9 * * *', timeZone: 'Africa/Nairobi' }, async () => {
  const today = new Date();
  const currentMonth = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const contributions = await db().collectionGroup('contributions').where('balance', '>', 0).get();
  const batch = db().batch();
  contributions.docs.forEach((contribution) => {
    const memberId = contribution.ref.parent.parent?.id;
    const month = String(contribution.data().month ?? contribution.id);
    if (!memberId || month > currentMonth) return;
    const type = month < currentMonth ? 'contribution.arrears' : 'contribution.due';
    const eventId = `${type.replace('.', '-')}-${memberId}-${month}`;
    batch.set(db().doc(`notification_events/${eventId}`), {
      type, memberId, contributionId: month, balance: Number(contribution.data().balance),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  await batch.commit();
});
