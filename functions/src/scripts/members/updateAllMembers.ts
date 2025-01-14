import * as admin from 'firebase-admin';
import * as serviceAccount from '../../../serviceAccount.json';
import {
  Contribution,
  MemberWithId,
  Payment,
  PAYMENT_STATUS,
} from '../../types';
import { arrayToChunks } from '../../utils';

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
});

// in functions directory use like:  ~ npm run build && node lib/src/scripts/members/updateAllMembers.js
const updateAllMembers = async () => {
  console.log('Start updateAllMembers ...!');

  const contributions: Contribution[] = [];
  const allPayments: Payment[] = [];
  const months = [
    '2024-07-01',
    '2024-08-01',
    '2024-09-01',
    '2024-10-01',
    '2024-11-01',
    '2024-12-01',
  ];

  const snapshot = await admin.firestore().collection('members').get();
  const members = snapshot.docs.map((doc) => {
    return {
      member_id: doc.id,
      ...doc.data(),
    } as MemberWithId;
  });

  members.forEach((member) => {
    months.forEach((month) => {
      const paymentId = admin
        .firestore()
        .collection('members')
        .doc(member.member_id)
        .collection('payments')
        .doc().id;
      const payment: Payment = {
        payment_id: paymentId,
        referencenumber: 'B/F',
        amount: 500,
        paymentdate: new Date(month),
        member_id: member.member_id,
        contribution_id: month,
        firstname: member.firstname,
        lastname: member.lastname,
        contribution_amount: 500,
      };
      allPayments.push(payment);
      const payments: Payment[] = [payment];
      const contribution: Contribution = {
        ...member,
        paid: PAYMENT_STATUS.PAID,
        amount: 500,
        createdat: new Date(month),
        month,
        payments,
        balance: 0,
      };

      contributions.push(contribution);
    });

    console.log('End of operation updateAllMembers ...!');
  });

  const contributionChunks = arrayToChunks(contributions, 500);
  console.log('chunks :: ', contributionChunks.length);

  for (const contribution of contributionChunks) {
    const bacth = admin.firestore().batch();
    contribution.forEach((contribution) => {
      const contributionRef = admin
        .firestore()
        .doc(
          `members/${contribution.member_id}/contributions/${contribution.month}`,
        );
      bacth.set(contributionRef, contribution, { merge: true });
    });
    await bacth.commit();
    console.log(`Batch of contribution ${contribution.length} committed`);
  }

  const paymentsChunks = arrayToChunks(allPayments, 500);
  console.log('payments chunks :: ', allPayments.length);

  for (const payment of paymentsChunks) {
    const bacth = admin.firestore().batch();
    payment.forEach((payment) => {
      const paymentRef = admin
        .firestore()
        .doc(`members/${payment.member_id}/payments/${payment.payment_id}`);
      bacth.set(paymentRef, payment, { merge: true });
    });
    await bacth.commit();
    console.log(`Batch of payments ${payment.length} committed`);
  }

  return;
};

updateAllMembers()
  .then(() => console.log('DONE'))
  .catch((err) => console.log('error :: ', err));
