import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { MemberWithId, PAYMENT_STATUS } from '../types';
import { arrayToChunks, getCurrentMonth, MONTHLY_CONTRIBUTION } from '../utils';

const db = () => admin.firestore();

const getContributionAmount = async (month: string) => {
  const configuration = await db().collection('contribution_rates')
    .where('effectiveFrom', '<=', month)
    .orderBy('effectiveFrom', 'desc')
    .limit(1)
    .get();
  const amount = configuration.empty ? MONTHLY_CONTRIBUTION : Number(configuration.docs[0].data().amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid monthly contribution configuration.');
  return amount;
};

const createForMember = async (member: MemberWithId, month: string, amount: number) =>
  db().runTransaction(async (transaction) => {
    const contributionRef = db().doc(`members/${member.member_id}/contributions/${month}`);
    if ((await transaction.get(contributionRef)).exists) return { created: false, applied: 0, payment: false };
    const memberRef = db().doc(`members/${member.member_id}`);
    const freshMember = (await transaction.get(memberRef)).data() as MemberWithId | undefined;
    if (!freshMember || freshMember.status !== 'active') return { created: false, applied: 0, payment: false };
    const accountBalance = Number(freshMember.balance ?? 0);
    const applied = Math.min(Math.max(accountBalance, 0), amount);
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
      };
      payments.push(payment);
      transaction.create(db().doc(`members/${member.member_id}/payments/${paymentId}`), payment);
    }
    transaction.create(contributionRef, {
      ...freshMember,
      member_id: member.member_id,
      amount,
      balance: remaining,
      paid: remaining === 0 ? PAYMENT_STATUS.PAID : applied > 0 ? PAYMENT_STATUS.PARTIAL : PAYMENT_STATUS.UNPAID,
      payments,
      createdat: admin.firestore.FieldValue.serverTimestamp(),
      month,
      action_by: 'system',
    });
    transaction.update(memberRef, {
      balance: admin.firestore.FieldValue.increment(-amount),
      contributionBalance: admin.firestore.FieldValue.increment(applied),
    });
    return { created: true, applied, payment: applied > 0 };
  });

export const generateMonthlyContributions = async (month = getCurrentMonth()) => {
  const amount = await getContributionAmount(month);
  const membersSnapshot = await db().collection('members').where('status', '==', 'active').get();
  const members = membersSnapshot.docs.map((member) => ({
    ...member.data(),
    member_id: member.id,
  }) as MemberWithId);
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
      const contribution = item.data();
      current.billed += Number(contribution.amount ?? 0);
      current.collected += Number(contribution.amount ?? 0) - Number(contribution.balance ?? 0);
      current.payments += Array.isArray(contribution.payments) ? contribution.payments.length : 0;
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
