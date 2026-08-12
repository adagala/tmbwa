import * as admin from 'firebase-admin';
import { Member } from '../../types';

admin.initializeApp({ credential: admin.credential.applicationDefault() });

const members: Partial<Member>[] = [];

// in functions directory use like:  ~ npm run build:scripts && node lib-scripts/scripts/members/addMembers.js
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
