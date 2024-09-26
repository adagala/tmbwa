import * as admin from 'firebase-admin';
import * as serviceAccount from '../../../serviceAccount.json';
import { GENDER, Member, MonthlyStats, ROLE, Stats, STATUS } from '../../types';
import {
  createIndex,
  getCurrentMonth,
  MONTHLY_CONTRIBUTION,
} from '../../utils';

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
});

const firstname = '';
const lastname = '';
const member: Member = {
  balance: 0,
  createat: admin.firestore.Timestamp.now(),
  email: '',
  gender: GENDER.MALE,
  firstname,
  lastname,
  firstnameSearchableIndex: createIndex(firstname),
  lastnameSearchableIndex: createIndex(lastname),
  membernumber: '00000/00',
  phonenumber: '+254720123456',
  role: ROLE.ADMINISTRATOR,
  status: STATUS.ACTIVE,
  isFeesPaid: false,
};

// in functions directory use like:  ~ npm run build && node lib/src/scripts/members/addAdminMember.js
const addAdminMember = async () => {
  console.log('Start addAdminMember ...!');

  const batch = admin.firestore().batch();

  const memberId = admin.firestore().collection('members').doc().id;
  const memberRef = admin.firestore().doc(`members/${memberId}`);
  batch.set(memberRef, member, { merge: true });

  // increase member count
  const statsRef = admin.firestore().doc('stats/--stats--');
  const stats: Partial<Stats> = {
    totalMembers: admin.firestore.FieldValue.increment(1),
  };
  batch.set(statsRef, stats, { merge: true });

  const monthlyStatsRef = admin
    .firestore()
    .doc(`monthly_stats/${getCurrentMonth()}`);
  const monthlyStats: Partial<MonthlyStats> = {
    newMembers: admin.firestore.FieldValue.increment(1),
    totalMembers: admin.firestore.FieldValue.increment(1),
    amount: admin.firestore.FieldValue.increment(MONTHLY_CONTRIBUTION),
  };
  batch.set(monthlyStatsRef, monthlyStats, { merge: true });

  await batch.commit();

  await admin.auth().createUser({
    email: member.email,
    password: member.phonenumber,
    displayName: `${member.firstname} ${member.lastname}`,
    phoneNumber: member.phonenumber,
    uid: memberId,
  });

  // set role customClaim
  await admin.auth().setCustomUserClaims(memberId, { role: member.role });

  console.log('End of operation addAdminMember ...!');
};

addAdminMember()
  .then(() => console.log('DONE'))
  .catch((err) => console.log('error :: ', err));
