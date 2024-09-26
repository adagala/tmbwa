import * as admin from 'firebase-admin';
import * as serviceAccount from '../../../serviceAccount.json';
import {
  Contribution,
  Member,
  MemberWithId,
  MonthlyStats,
  Payment,
  PAYMENT_STATUS,
} from '../../types';
import { getCurrentMonth, MONTHLY_CONTRIBUTION } from '../../utils';

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
});

// in functions directory use like:  ~ npm run build && node lib/src/scripts/contributions/setMonthlyContributions.js
const setMonthlyContributions = async () => {
  // get all members
  const membersRef = admin.firestore().collection('members').limit(5);
  const membersSnapshot = await membersRef.get();
  const members = membersSnapshot.docs.map((member) => {
    const _member = {
      ...member.data(),
      member_id: member.id,
    } as MemberWithId;
    return _member;
  });

  const contributions: Partial<Contribution>[] = [];

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

    let payment: Payment | undefined = undefined;

    if (contributionAmount > 0) {
      paymentsCount = paymentsCount + 1;

      const paymentsRef = admin
        .firestore()
        .collection(`members/${member.member_id}/payments`);
      const paymentId = paymentsRef.doc().id;
      const paymentRef = admin
        .firestore()
        .doc(`members/${member.member_id}/payments/${paymentId}`);

      const memberPayment: Payment = {
        amount: contributionAmount,
        paymentdate: admin.firestore.Timestamp.now(),
        referencenumber: 'BALANCE B/F',
        contribution_id: month,
        firstname: member.firstname,
        lastname: member.lastname,
        member_id: member.member_id,
        payment_id: paymentId,
      };
      payment = memberPayment;
      batch.set(paymentRef, payment, { merge: true });
    }

    const contribution: Partial<Contribution> = {
      ...member,
      amount: MONTHLY_CONTRIBUTION,
      balance: contributionBalance,
      paid:
        contributionBalance === 0
          ? PAYMENT_STATUS.PAID
          : contributionBalance === MONTHLY_CONTRIBUTION
            ? PAYMENT_STATUS.UNPAID
            : PAYMENT_STATUS.PARTIAL,
      ...(payment?.payment_id && {
        payments: admin.firestore.FieldValue.arrayUnion(payment),
      }),
      createdat: admin.firestore.Timestamp.now(),
      month,
    };
    contributions.push(contribution);
    batch.set(memberContributionRef, contribution, {
      merge: true,
    });

    const memberRef = admin.firestore().doc(`members/${member.member_id}`);
    const memberData: Partial<Member> = {
      balance: newMemberBalance,
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
  console.log(stats);
  batch.set(statsRef, stats, { merge: true });

  return batch.commit();
};

setMonthlyContributions()
  .then(() => console.log('DONE'))
  .catch((err) => console.log('error :: ', err));
