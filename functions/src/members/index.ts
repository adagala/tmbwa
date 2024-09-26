import * as admin from 'firebase-admin';
import {
  onDocumentCreated,
  onDocumentDeleted,
  onDocumentUpdated,
} from 'firebase-functions/v2/firestore';
import { Member, MonthlyStats, Stats } from '../types';
import { createIndex, getCurrentMonth, MONTHLY_CONTRIBUTION } from '../utils';

export const newMember = onDocumentCreated(
  'members/{memberId}',
  async (event) => {
    const uid = event.data?.id;

    if (!uid) return null;

    const member = event.data?.data() as Member;
    const batch = admin.firestore().batch();

    // searcheable index
    const firstnameSearchableIndex = createIndex(member.firstname);
    const lastnameSearchableIndex = createIndex(member.lastname);

    // created at timestamp
    const memberRef = admin.firestore().doc(`members/${uid}`);
    const memberUpdate: Partial<Member> = {
      createat: admin.firestore.Timestamp.now(),
      firstnameSearchableIndex,
      lastnameSearchableIndex,
    };

    batch.set(memberRef, memberUpdate, { merge: true });

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

    // create account with default password as phone number
    await admin.auth().createUser({
      email: member.email,
      password: member.phonenumber,
      displayName: `${member.firstname} ${member.lastname}`,
      phoneNumber: member.phonenumber,
      uid,
    });

    // set role customClaim
    await admin.auth().setCustomUserClaims(uid, { role: member.role });
    return null;
  },
);

export const deleteMember = onDocumentDeleted(
  'members/{memberId}',
  async (event) => {
    const uid = event.data?.id;

    if (!uid) return null;

    const batch = admin.firestore().batch();

    // decrease member count
    const statsRef = admin.firestore().doc('stats/--stats--');
    const stats: Partial<Stats> = {
      totalMembers: admin.firestore.FieldValue.increment(-1),
    };
    batch.set(statsRef, stats, { merge: true });

    const currentMonthStatsRef = admin
      .firestore()
      .doc(`monthly_stats/${getCurrentMonth()}`);
    const monthlyStats: Partial<MonthlyStats> = {
      totalMembers: admin.firestore.FieldValue.increment(-1),
    };
    batch.set(currentMonthStatsRef, monthlyStats, { merge: true });

    await batch.commit();

    // delete account
    return admin.auth().deleteUser(uid);
  },
);

export const updateMember = onDocumentUpdated(
  'members/{memberId}',
  async (event) => {
    const uid = event.data?.after.id;

    if (!uid) return null;

    const memberBefore = event.data?.before.data() as Member;
    const memberAfter = event.data?.after.data() as Member;

    console.log(memberBefore.firstname, memberBefore.lastname);

    // if name updated, update auth displayName
    if (
      memberBefore.firstname !== memberAfter.firstname ||
      memberBefore.lastname !== memberAfter.lastname
    ) {
      // searcheable index
      const firstnameSearchableIndex = createIndex(memberAfter.firstname);
      const lastnameSearchableIndex = createIndex(memberAfter.lastname);

      const memberRef = admin.firestore().doc(`members/${uid}`);
      const memberUpdate: Partial<Member> = {
        firstnameSearchableIndex,
        lastnameSearchableIndex,
      };
      await memberRef.set(memberUpdate, { merge: true });

      await admin.auth().updateUser(uid, {
        displayName: `${memberAfter.firstname} ${memberAfter.lastname}`,
      });
    }

    // if phone number updated, update phone
    if (memberBefore.phonenumber !== memberAfter.phonenumber) {
      await admin
        .auth()
        .updateUser(uid, { phoneNumber: memberAfter.phonenumber });
    }

    // if role updated, update customClaims for role
    if (memberBefore.role !== memberAfter.role) {
      await admin.auth().setCustomUserClaims(uid, { role: memberAfter.role });
    }

    return null;
  },
);
