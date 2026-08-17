import * as admin from 'firebase-admin';
import { MemberContribution, MemberWithId } from '../../types';
import { PAYMENT_STATUS } from 'tmbwa-shared';
import { memberWithIdData } from '../../firestoreData';

admin.initializeApp({ credential: admin.credential.applicationDefault() });

// in functions directory use like:  ~ npm run build:scripts && node lib-scripts/scripts/contributions/updateContributions.js
const updateContributions = async () => {
  console.log('Update contributions ...!');

  const membersRef = admin.firestore().collection('members');
  const membersSnapshot = await membersRef.get();
  const members = membersSnapshot.docs.map(memberWithIdData) as MemberWithId[];

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
