import { HttpsError } from 'firebase-functions/v2/https';
import {
  contributionDocumentSchema,
  kcbPaymentNotificationDocumentSchema,
  kcbStkRequestDocumentSchema,
  memberDocumentSchema,
  memberWithIdDocumentSchema,
  notificationDeliveryDocumentSchema,
  notificationEventDocumentSchema,
  notificationPreferenceDocumentSchema,
  paymentDocumentSchema,
} from 'tmbwa-shared';

const parseSnapshot = <Result>(
  snapshot: FirebaseFirestore.DocumentSnapshot,
  schema: {
    safeParse(value: unknown):
      | { success: true; data: Result }
      | { success: false; error: { message: string } };
  },
  label: string,
  value: unknown = snapshot.data(),
) => {
  if (!snapshot.exists || value === undefined) {
    throw new HttpsError('not-found', `${label} not found.`);
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpsError(
      'data-loss',
      `Invalid Firestore document at ${snapshot.ref.path}: ${result.error.message}`,
    );
  }
  return result.data;
};

export const validateDocumentWrite = <Result>(
  schema: {
    safeParse(value: unknown):
      | { success: true; data: Result }
      | { success: false; error: { message: string } };
  },
  value: unknown,
  path: string,
) => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpsError(
      'internal',
      `Refused invalid Firestore write at ${path}: ${result.error.message}`,
    );
  }
  return result.data;
};

export const memberData = (snapshot: FirebaseFirestore.DocumentSnapshot) =>
  parseSnapshot(snapshot, memberDocumentSchema, 'Member');

export const memberWithIdData = (snapshot: FirebaseFirestore.DocumentSnapshot) =>
  parseSnapshot(
    snapshot,
    memberWithIdDocumentSchema,
    'Member',
    { member_id: snapshot.id, ...snapshot.data() },
  );

export const contributionData = (snapshot: FirebaseFirestore.DocumentSnapshot) =>
  parseSnapshot(
    snapshot,
    contributionDocumentSchema,
    'Contribution',
    { contribution_id: snapshot.id, ...snapshot.data() },
  );

export const paymentData = (snapshot: FirebaseFirestore.DocumentSnapshot) =>
  parseSnapshot(
    snapshot,
    paymentDocumentSchema,
    'Payment',
    { payment_id: snapshot.id, ...snapshot.data() },
  );

export const kcbPaymentNotificationData = (snapshot: FirebaseFirestore.DocumentSnapshot) =>
  parseSnapshot(snapshot, kcbPaymentNotificationDocumentSchema, 'KCB payment notification');

export const kcbStkRequestData = (snapshot: FirebaseFirestore.DocumentSnapshot) =>
  parseSnapshot(snapshot, kcbStkRequestDocumentSchema, 'KCB STK request');

export const notificationEventData = (snapshot: FirebaseFirestore.DocumentSnapshot) =>
  parseSnapshot(snapshot, notificationEventDocumentSchema, 'Notification event');

export const notificationDeliveryData = (snapshot: FirebaseFirestore.DocumentSnapshot) =>
  parseSnapshot(snapshot, notificationDeliveryDocumentSchema, 'Notification delivery');

export const notificationPreferenceData = (snapshot: FirebaseFirestore.DocumentSnapshot) =>
  parseSnapshot(snapshot, notificationPreferenceDocumentSchema, 'Notification preference');
