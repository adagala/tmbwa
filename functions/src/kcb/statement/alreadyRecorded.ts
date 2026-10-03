import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { PAYMENT_STATUS, auditEventDocumentSchema } from 'tmbwa-shared';
import { admin } from '../../firebaseAdmin';
import { assertNotOwnRecord, reauthorizeActor, requirePermission } from '../../authorization';
import { kcbPaymentNotificationData, validateDocumentWrite } from '../../firestoreData';

// "Already recorded" (#94): a payment imported from a KCB statement that the
// app already accounts for in a payment or paid month recorded by hand, but
// that the import could not match by M-Pesa code. Linking it changes no
// balance, contribution, credit, payment or statistic; it only takes the
// payment out of the reconciliation queue, and can be undone.

const db = () => admin.firestore();
const MAX_LINKS = 24;

type Data = Record<string, unknown>;

const requiredString = (data: Data, key: string) => {
  const value = data[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpsError('invalid-argument', `${key} is required.`);
  }
  return value.trim();
};

const idList = (data: Data, key: string) => {
  const value = data[key] ?? [];
  if (
    !Array.isArray(value) ||
    value.length > MAX_LINKS ||
    !value.every((item) => typeof item === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(item))
  ) {
    throw new HttpsError('invalid-argument', `${key} must be a list of document IDs.`);
  }
  return [...new Set(value as string[])];
};

// One existing payment accounts for at most one statement payment.
const paymentLinkRef = (memberId: string, paymentId: string) =>
  db().doc(`kcb_legacy_payment_links/${memberId}_${paymentId}`);

const writeAudit = (
  transaction: FirebaseFirestore.Transaction,
  requestId: string,
  actor: { actorId: string; actorRoles: string[] },
  action: string,
  memberId: string,
  providerTransactionId: string,
  changes: Record<string, unknown>,
) => {
  const path = `audit_events/${requestId}`;
  transaction.create(db().doc(path), validateDocumentWrite(auditEventDocumentSchema, {
    requestId,
    actorId: actor.actorId,
    actorRoles: actor.actorRoles,
    action,
    memberId,
    targetId: providerTransactionId,
    changes,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, path));
};

export const markKcbPaymentAlreadyRecorded = onCall(async (request) => {
  const actor = await requirePermission(request.auth, 'kcb.reconcile');
  const data = request.data as Data;
  const requestId = requiredString(data, 'requestId');
  const providerTransactionId = requiredString(data, 'providerTransactionId');
  const memberId = requiredString(data, 'memberId');
  const reason = requiredString(data, 'reason');
  const paymentIds = idList(data, 'paymentIds');
  const contributionIds = idList(data, 'contributionIds');
  assertNotOwnRecord(actor.actorId, memberId);
  if (!paymentIds.length && !contributionIds.length) {
    throw new HttpsError('invalid-argument', 'Link at least one existing payment or paid month.');
  }

  return db().runTransaction(async (transaction) => {
    await reauthorizeActor(transaction, actor);
    const commandRef = db().doc(`financial_commands/${requestId}`);
    const notificationRef = db().doc(`kcb_payment_notifications/${providerTransactionId}`);
    const memberRef = db().doc(`members/${memberId}`);
    const paymentRefs = paymentIds.map((id) => db().doc(`members/${memberId}/payments/${id}`));
    const contributionRefs = contributionIds.map((id) => db().doc(`members/${memberId}/contributions/${id}`));
    const linkRefs = paymentIds.map((id) => paymentLinkRef(memberId, id));
    const [command, notificationSnapshot, member, ...rest] = await Promise.all([
      transaction.get(commandRef),
      transaction.get(notificationRef),
      transaction.get(memberRef),
      ...paymentRefs.map((ref) => transaction.get(ref)),
      ...contributionRefs.map((ref) => transaction.get(ref)),
      ...linkRefs.map((ref) => transaction.get(ref)),
    ]);
    if (command.exists) return { requestId, duplicate: true };
    if (!notificationSnapshot.exists) throw new HttpsError('not-found', 'KCB payment notification not found.');
    const notification = kcbPaymentNotificationData(notificationSnapshot);
    if (notification.source !== 'statement_import') {
      throw new HttpsError('failed-precondition', 'Only payments imported from a statement can be marked already recorded.');
    }
    if (notification.status !== 'unresolved') {
      throw new HttpsError('failed-precondition', 'Only unresolved payments can be marked already recorded.');
    }
    if (!member.exists) throw new HttpsError('not-found', 'Member not found.');
    const payments = rest.slice(0, paymentRefs.length);
    const contributions = rest.slice(paymentRefs.length, paymentRefs.length + contributionRefs.length);
    const links = rest.slice(paymentRefs.length + contributionRefs.length);
    if (payments.some((snapshot) => !snapshot.exists)) {
      throw new HttpsError('not-found', 'A linked payment does not exist for this member.');
    }
    if (contributions.some((snapshot) => !snapshot.exists)) {
      throw new HttpsError('not-found', 'A linked month does not exist for this member.');
    }
    if (contributions.some((snapshot) =>
      ![PAYMENT_STATUS.PAID, PAYMENT_STATUS.PARTIAL].includes(snapshot.get('paid')))) {
      throw new HttpsError('failed-precondition', 'Only paid or partially paid months can account for a payment.');
    }
    const taken = links.find((snapshot) => snapshot.exists);
    if (taken) {
      throw new HttpsError(
        'failed-precondition',
        `That payment already accounts for statement payment ${taken.get('providerTransactionId')}.`,
      );
    }

    transaction.create(commandRef, {
      type: 'markKcbPaymentAlreadyRecorded',
      actorId: actor.actorId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    linkRefs.forEach((ref, index) => transaction.create(ref, {
      memberId,
      paymentId: paymentIds[index],
      providerTransactionId,
      requestId,
      linkedBy: actor.actorId,
      linkedAt: admin.firestore.FieldValue.serverTimestamp(),
    }));
    transaction.update(notificationRef, {
      status: 'already_recorded',
      memberId,
      linkedPaymentIds: paymentIds,
      linkedContributionIds: contributionIds,
      alreadyRecordedReason: reason,
      alreadyRecordedBy: actor.actorId,
      alreadyRecordedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    writeAudit(transaction, requestId, actor, 'payment.already_recorded', memberId, providerTransactionId, {
      amount: notification.amount,
      linkedPaymentIds: paymentIds,
      linkedContributionIds: contributionIds,
      reason,
    });
    return { requestId, duplicate: false };
  });
});

export const undoKcbPaymentAlreadyRecorded = onCall(async (request) => {
  const actor = await requirePermission(request.auth, 'kcb.reconcile');
  const data = request.data as Data;
  const requestId = requiredString(data, 'requestId');
  const providerTransactionId = requiredString(data, 'providerTransactionId');
  const reason = requiredString(data, 'reason');

  return db().runTransaction(async (transaction) => {
    await reauthorizeActor(transaction, actor);
    const commandRef = db().doc(`financial_commands/${requestId}`);
    const notificationRef = db().doc(`kcb_payment_notifications/${providerTransactionId}`);
    const [command, notificationSnapshot] = await Promise.all([
      transaction.get(commandRef),
      transaction.get(notificationRef),
    ]);
    if (command.exists) return { requestId, duplicate: true };
    if (!notificationSnapshot.exists) throw new HttpsError('not-found', 'KCB payment notification not found.');
    const notification = kcbPaymentNotificationData(notificationSnapshot);
    if (notification.status !== 'already_recorded') {
      throw new HttpsError('failed-precondition', 'This payment is not marked already recorded.');
    }
    const memberId = String(notification.memberId ?? '');
    assertNotOwnRecord(actor.actorId, memberId);
    const linkedPaymentIds = (notificationSnapshot.get('linkedPaymentIds') ?? []) as string[];
    const linkedContributionIds = (notificationSnapshot.get('linkedContributionIds') ?? []) as string[];
    const linkRefs = linkedPaymentIds.map((id) => paymentLinkRef(memberId, id));
    const links = await Promise.all(linkRefs.map((ref) => transaction.get(ref)));

    transaction.create(commandRef, {
      type: 'undoKcbPaymentAlreadyRecorded',
      actorId: actor.actorId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    links.forEach((link) => {
      if (link.exists && link.get('providerTransactionId') === providerTransactionId) transaction.delete(link.ref);
    });
    // Back in the queue with no member, so reconciliation is not locked to it.
    transaction.update(notificationRef, {
      status: 'unresolved',
      memberId: admin.firestore.FieldValue.delete(),
      linkedPaymentIds: admin.firestore.FieldValue.delete(),
      linkedContributionIds: admin.firestore.FieldValue.delete(),
      alreadyRecordedReason: admin.firestore.FieldValue.delete(),
      alreadyRecordedBy: admin.firestore.FieldValue.delete(),
      alreadyRecordedAt: admin.firestore.FieldValue.delete(),
      alreadyRecordedHistory: admin.firestore.FieldValue.arrayUnion({
        requestId,
        memberId,
        linkedPaymentIds,
        linkedContributionIds,
        markedReason: notificationSnapshot.get('alreadyRecordedReason') ?? null,
        markedBy: notificationSnapshot.get('alreadyRecordedBy') ?? null,
        undoneReason: reason,
        undoneBy: actor.actorId,
        undoneAt: admin.firestore.Timestamp.now(),
      }),
    });
    writeAudit(transaction, requestId, actor, 'payment.already_recorded_undone', memberId, providerTransactionId, {
      linkedPaymentIds,
      linkedContributionIds,
      reason,
    });
    return { requestId, duplicate: false };
  });
});
