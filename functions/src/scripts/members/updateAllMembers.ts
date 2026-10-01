import { admin } from '../../firebaseAdmin';
import {
  Member,
  MemberWithId,
} from '../../types';
import { MEMBER_STATUS } from 'tmbwa-shared';
import { resolve } from 'path';
import { cert } from 'firebase-admin/app';

const CREDENTIALS_FLAG = '--credentials';

const argValue = (flag: string) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};

const credentialsPath = argValue(CREDENTIALS_FLAG);
admin.initializeApp({
  credential: credentialsPath ?
    cert(resolve(credentialsPath)) :
    admin.credential.applicationDefault(),
});
// in functions directory use like:  ~ npm run build:scripts && node lib-scripts/scripts/members/updateAllMembers.js --credentials src/serviceAccount.json
const updateAllMembers = async () => {
  console.log('Start updateAllMembers ...!');

  const snapshot = await admin.firestore().collection('members').get();
  const members = snapshot.docs.map(doc => ({ member_id: doc.id, ...doc.data() })) as MemberWithId[];

  const batch = admin.firestore().batch();

  members.forEach((member) => {
      const memberRef = admin.firestore().collection('members').doc(member.member_id)
      const data:Partial<Member> = {
        status: MEMBER_STATUS.ACTIVE
      }
      batch.update(memberRef, data);
  });

  await batch.commit();
  console.log('End of operation updateAllMembers ...!');

  return;
};

updateAllMembers()
  .then(() => console.log('DONE'))
  .catch((err) => console.log('error :: ', err));
