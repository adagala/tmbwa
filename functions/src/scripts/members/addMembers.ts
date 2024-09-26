import * as admin from 'firebase-admin';
import * as serviceAccount from '../../../serviceAccount.json';
import { Member } from '../../types';

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
});

const members: Partial<Member>[] = [];

// in functions directory use like:  ~ tsc && node lib/src/scripts/members/addMembers.js
const addMembers = async () => {
  console.log('Start addMembers ...!');

  const bacth = admin.firestore().batch();

  members.forEach((member) => {
    const memberId = admin.firestore().collection('members').doc().id;
    const memberRef = admin.firestore().doc(`members/${memberId}`);
    bacth.set(memberRef, member, { merge: true });
  });

  await bacth.commit();

  console.log('End of operation addMembers ...!');
};

addMembers()
  .then(() => console.log('DONE'))
  .catch((err) => console.log('error :: ', err));
