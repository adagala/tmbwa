import * as admin from 'firebase-admin';
import * as serviceAccount from '../../../serviceAccount.json';
import { MemberContribution, MemberWithId, PAYMENT_STATUS } from '../../types';

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
});

// in functions directory use like:  ~ tsc && node lib/src/scripts/contributions/updateContributions.js
const updateContributions = async () => {
  console.log('Update contributions ...!');

  const membersRef = admin.firestore().collection('members');
  const membersSnapshot = await membersRef.get();
  const members = membersSnapshot.docs.map((member) => {
    const _member = {
      ...member.data(),
      member_id: member.id,
    } as MemberWithId;
    return _member;
  });

  const bacth = admin.firestore().batch();

  members.forEach((member) => {
    const memberRef = admin
      .firestore()
      .doc(`members/${member.member_id}/contributions/2024-07-01`);
    const memberUpdate: Partial<MemberContribution> = {
      paid: PAYMENT_STATUS.UNPAID,
    };
    bacth.update(memberRef, memberUpdate);
  });

  await bacth.commit();

  console.log('End of operation updateContributions ...!');
};

updateContributions()
  .then(() => console.log('DONE'))
  .catch((err) => console.log('error :: ', err));
