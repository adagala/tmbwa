import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  Member,
  Contribution,
  MemberWithId,
  MonthlyStats,
  Payment,
  PAYMENT_STATUS,
} from '../types';
import { getCurrentMonth, MONTHLY_CONTRIBUTION } from '../utils';

// Runs at  midnight at the start of every month
export const setMonthlyContributions = onSchedule(
  {
    schedule: '0 0 1 * *',
    timeZone: 'Africa/Nairobi',
  },
  async () => {
    // get all members
    const membersRef = admin.firestore().collection('members');
    const membersSnapshot = await membersRef.get();
    const members = membersSnapshot.docs.map((member) => {
      const _member = {
        ...member.data(),
        member_id: member.id,
      } as MemberWithId;
      return _member;
    });

    const month = getCurrentMonth();

    // create a document for each member for that month
    const batch = admin.firestore().batch();

    let totalContribution = 0;
    let paymentsCount = 0;
    members.forEach((member) => {
      const memberContributionRef = admin
        .firestore()
        .doc(`members/${member.member_id}/contributions/${month}`);
      const memberBalance = (member.balance as number) || 0;
      const newMemberBalance = memberBalance - MONTHLY_CONTRIBUTION;
      const contributionAmount =
        memberBalance > MONTHLY_CONTRIBUTION
          ? MONTHLY_CONTRIBUTION
          : memberBalance <= 0
            ? 0
            : memberBalance;
      const contributionBalance = MONTHLY_CONTRIBUTION - contributionAmount;
      totalContribution = totalContribution + contributionAmount;

      const payments: Payment[] = [];

      if (contributionAmount > 0) {
        paymentsCount = paymentsCount + 1;

        const paymentsRef = admin
          .firestore()
          .collection(`members/${member.member_id}/payments`);
        const paymentId = paymentsRef.doc().id;
        const paymentRef = admin
          .firestore()
          .doc(`members/${member.member_id}/payments/${paymentId}`);

        const payment: Payment = {
          amount: contributionAmount,
          paymentdate: admin.firestore.Timestamp.now(),
          referencenumber: 'BALANCE B/F',
          contribution_id: month,
          firstname: member.firstname,
          lastname: member.lastname,
          member_id: member.member_id,
          payment_id: paymentId,
        };
        payments.push(payment);
        batch.set(paymentRef, payment, { merge: true });
      }

      const contribution: Contribution = {
        ...member,
        amount: MONTHLY_CONTRIBUTION,
        balance: contributionBalance,
        paid:
          contributionBalance === 0
            ? PAYMENT_STATUS.PAID
            : contributionBalance === MONTHLY_CONTRIBUTION
              ? PAYMENT_STATUS.UNPAID
              : PAYMENT_STATUS.PARTIAL,
        payments,
        createdat: admin.firestore.Timestamp.now(),
        month,
      };
      batch.set(memberContributionRef, contribution, {
        merge: true,
      });

      const memberRef = admin.firestore().doc(`members/${member.member_id}`);
      const memberData: Partial<Member> = {
        balance: admin.firestore.FieldValue.increment(newMemberBalance),
      };
      batch.set(memberRef, memberData, { merge: true });
    });

    const statsRef = admin.firestore().doc(`monthly_stats/${month}`);
    const stats: MonthlyStats = {
      amount: members.length * MONTHLY_CONTRIBUTION,
      contribution: totalContribution,
      totalMembers: members.length,
      month,
      paymentsCount,
      newMembers: 0,
    };
    batch.set(statsRef, stats, { merge: true });

    await batch.commit();

    return;
  },
);
