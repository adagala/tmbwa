import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { MemberWithId } from '../types';
import {
  MONTHLY_CONTRIBUTION,
  PAYMENT_STATUS,
  contributionRateDocumentSchema,
  contributionDocumentSchema,
  parseDocument,
  paymentDocumentSchema,
} from 'tmbwa-shared';
import { arrayToChunks, getCurrentMonth } from '../utils';
import {
  contributionData,
  memberWithIdData,
  validateDocumentWrite,
} from '../firestoreData';
import { availableUnreservedBalance } from '../financial/domain';

const db = () => admin.firestore();

const getContributionAmount = async (month: string) => {
  const configuration = await db().collection('contribution_rates')
    .where('effectiveFrom', '<=', month)
    .orderBy('effectiveFrom', 'desc')
    .limit(1)
    .get();
  const amount = configuration.empty
    ? MONTHLY_CONTRIBUTION
    : parseDocument(
      contributionRateDocumentSchema,
      configuration.docs[0].data(),
      configuration.docs[0].ref.path,
    ).amount;
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid monthly contribution configuration.');
  return amount;
};

const createForMember = async (member: MemberWithId, month: string, amount: number) =>
  db().runTransaction(async (transaction) => {
    const contributionRef = db().doc(`members/${member.member_id}/contributions/${month}`);
    if ((await transaction.get(contributionRef)).exists) return { created: false, applied: 0, payment: false };
    const memberRef = db().doc(`members/${member.member_id}`);
    const freshMemberSnapshot = await transaction.get(memberRef);
    const freshMember = memberWithIdData(freshMemberSnapshot);
    if (freshMember.status !== 'active') return { created: false, applied: 0, payment: false };
    const accountBalance = Number(freshMember.balance ?? 0);
    const applied = Math.min(
      availableUnreservedBalance(
        accountBalance, Number(freshMember.reservedKcbCredit ?? 0),
      ),
      amount,
    );
    const remaining = amount - applied;
    const payments: Record<string, unknown>[] = [];
    if (applied > 0) {
      const paymentId = db().collection(`members/${member.member_id}/payments`).doc().id;
      const createdAt = admin.firestore.Timestamp.now();
      const payment = {
        payment_id: paymentId,
        amount: applied,
        contribution_amount: applied,
        paymentdate: createdAt,
        created_at: createdAt,
        referencenumber: 'BALANCE B/F',
        contribution_id: month,
        firstname: freshMember.firstname,
        lastname: freshMember.lastname,
        member_id: member.member_id,
        payment_type: 'contribution',
        action_by: 'system',
        request_id: `monthly:${month}:${member.member_id}`,
        receipt_number: `TMBWA-${paymentId.toUpperCase()}`,
      };
      const paymentPath = `members/${member.member_id}/payments/${paymentId}`;
      const validatedPayment = validateDocumentWrite(paymentDocumentSchema, payment, paymentPath);
      payments.push(validatedPayment);
      transaction.create(db().doc(paymentPath), validatedPayment);
    }
    transaction.create(contributionRef, validateDocumentWrite(contributionDocumentSchema, {
      ...freshMember,
      member_id: member.member_id,
      amount,
      balance: remaining,
      paid: remaining === 0 ? PAYMENT_STATUS.PAID : applied > 0 ? PAYMENT_STATUS.PARTIAL : PAYMENT_STATUS.UNPAID,
      payments,
      createdat: admin.firestore.FieldValue.serverTimestamp(),
      month,
      action_by: 'system',
      contribution_id: month,
    }, contributionRef.path));
    transaction.update(memberRef, {
      balance: admin.firestore.FieldValue.increment(-amount),
      contributionBalance: admin.firestore.FieldValue.increment(applied),
    });
    return { created: true, applied, payment: applied > 0 };
  });

export const generateMonthlyContributions = async (month = getCurrentMonth()) => {
  const amount = await getContributionAmount(month);
  const membersSnapshot = await db().collection('members').where('status', '==', 'active').get();
  const members = membersSnapshot.docs.map(memberWithIdData) as MemberWithId[];
  let created = 0;
  for (const chunk of arrayToChunks(members, 50)) {
    const results = await Promise.all(chunk.map((member) => createForMember(member, month, amount)));
    for (const result of results) {
      if (result.created) created += 1;
    }
  }
  const totals = await db().runTransaction(async (transaction) => {
    const contributionsQuery = db().collectionGroup('contributions').where('month', '==', month);
    const contributionsSnapshot = await transaction.get(contributionsQuery);
    const summary = contributionsSnapshot.docs.reduce((current, item) => {
      const contribution = contributionData(item);
      current.billed += contribution.amount;
      current.collected += contribution.amount - contribution.balance;
      current.payments += contribution.payments.length;
      return current;
    }, { billed: 0, collected: 0, payments: 0 });
    transaction.set(db().doc(`monthly_stats/${month}`), {
      amount: summary.billed,
      contribution: summary.collected,
      totalMembers: contributionsSnapshot.size,
      month,
      paymentsCount: summary.payments,
      newMembers: 0,
      generationStatus: 'complete',
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ...summary, members: contributionsSnapshot.size };
  });
  return { month, amount, created, ...totals };
};

export const setMonthlyContributions = onSchedule({
  schedule: '0 0 1 * *',
  timeZone: 'Africa/Nairobi',
  retryCount: 3,
}, async () => {
  await generateMonthlyContributions();
});
