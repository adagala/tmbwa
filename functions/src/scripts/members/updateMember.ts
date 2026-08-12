import * as admin from 'firebase-admin';
import { Member } from '../../types';

admin.initializeApp({ credential: admin.credential.applicationDefault() });

type TMember = Omit<
  Member,
  | 'createat'
  | 'firstnameSearchableIndex'
  | 'lastnameSearchableIndex'
  | 'balance'
  | 'contributionBalance'
>;

// add other fields that you need to update for the member
const member: Partial<TMember> & { uid: string; password?: string } = {
  uid: '',
};

// in functions directory use like:  ~ npm run build:scripts && node lib-scripts/scripts/members/updateMember.js
const updateMember = async () => {
  console.log('Start updateMemberPassword ...!');

  const { uid, password } = member;

  if (password) {
    await admin.auth().updateUser(uid, { password });
  }

  const memberRef = admin.firestore().doc(`members/${uid}`);
  memberRef.update(memberRef, member);

  console.log('End of operation updateMemberPassword ...!');
};

updateMember()
  .then(() => console.log('DONE'))
  .catch((err) => console.log('error :: ', err));
