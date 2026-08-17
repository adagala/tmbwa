import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import {
  memberNotificationDocumentSchema,
  notificationDeliveryDocumentSchema,
  notificationEventDocumentSchema,
} from 'tmbwa-shared';
import { nextAttemptDelayMs, renderNotification } from './domain';
import {
  contributionData,
  notificationDeliveryData,
  notificationEventData,
  notificationPreferenceData,
  validateDocumentWrite,
} from '../firestoreData';

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
  const notification = notificationEventData(snapshot);
  const memberId = notification.memberId;
  const preferences = await db().doc(`members/${memberId}/notification_preferences/default`).get();
  if (preferences.exists && !notificationPreferenceData(preferences).inAppEnabled) return;
  const deliveryRef = db().doc(`notification_deliveries/${event.params.eventId}-in_app`);
  try {
    await deliveryRef.create(validateDocumentWrite(notificationDeliveryDocumentSchema, {
      eventId: event.params.eventId, memberId, channel: 'in_app', status: 'pending', attempts: 0,
      nextAttemptAt: admin.firestore.Timestamp.now(), createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, deliveryRef.path));
  } catch (error) {
    if ((error as { code?: number }).code !== 6) throw error;
  }
});

const deliver = async (delivery: FirebaseFirestore.QueryDocumentSnapshot) => {
  const data = notificationDeliveryData(delivery);
  const eventSnapshot = await db().doc(`notification_events/${data.eventId}`).get();
  if (!eventSnapshot.exists) throw new Error('Notification event not found.');
  const event = notificationEventData(eventSnapshot);
  const message = renderNotification(event);
  await db().runTransaction(async (transaction) => {
    const current = await transaction.get(delivery.ref);
    if (!current.exists || notificationDeliveryData(current).status !== 'pending') return;
    const notificationPath = `members/${data.memberId}/notifications/${delivery.id}`;
    transaction.create(db().doc(notificationPath), validateDocumentWrite(memberNotificationDocumentSchema, {
      eventId: data.eventId, channel: data.channel, ...message, read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, notificationPath));
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
      const attempts = notificationDeliveryData(delivery).attempts + 1;
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
    if (!['failed', 'dead_letter'].includes(notificationDeliveryData(snapshot).status)) {
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
  const reminderDate = today.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
  const contributions = await db().collectionGroup('contributions').where('balance', '>', 0).get();
  const writer = db().bulkWriter();
  contributions.docs.forEach((contribution) => {
    const memberId = contribution.ref.parent.parent?.id;
    const contributionRecord = contributionData(contribution);
    const month = contributionRecord.month;
    if (!memberId || month > currentMonth) return;
    const type = month < currentMonth ? 'contribution.arrears' : 'contribution.due';
    const eventId = `${type.replace('.', '-')}-${memberId}-${month}-${reminderDate}`;
    writer.set(db().doc(`notification_events/${eventId}`), validateDocumentWrite(notificationEventDocumentSchema, {
      type, memberId, contributionId: month, balance: contributionRecord.balance,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, `notification_events/${eventId}`));
  });
  await writer.close();
});
