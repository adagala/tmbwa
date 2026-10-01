import { admin } from '../firebaseAdmin';
import {
  onDocumentCreated,
  onDocumentDeleted,
  onDocumentUpdated,
} from 'firebase-functions/v2/firestore';
import { Member, MonthlyStats, Stats } from '../types';
import {
  createIndex,
  createBootstrapPassword,
  deleteCollection,
  getCurrentMonth,
} from '../utils';
import {
  MONTHLY_CONTRIBUTION,
  legacyRoleFor,
  memberFormBaseSchema,
  memberRoles,
  parseDocument,
  sameRoles,
} from 'tmbwa-shared';
import { memberData } from '../firestoreData';

export { assignMemberRoles } from './roles';

export const newMember = onDocumentCreated(
  {
    document: 'members/{memberId}',
    region: 'asia-south1',
  },
  async (event) => {
    const snapshot = event.data;
    const uid = snapshot?.id;

    if (!snapshot || !uid) return null;

    const member = parseDocument(
      memberFormBaseSchema,
      snapshot.data(),
      snapshot.ref.path,
    );
    const batch = admin.firestore().batch();

    // searcheable index
    const firstnameSearchableIndex = createIndex(member.firstname);
    const lastnameSearchableIndex = createIndex(member.lastname);

    // created at timestamp
    const memberRef = admin.firestore().doc(`members/${uid}`);
    // Client-created members always start as plain members (Firestore rules
    // enforce it); privileged roles are granted only through assignMemberRoles.
    const roles = memberRoles(snapshot.data());
    const memberUpdate: Partial<Member> = {
      createat: admin.firestore.Timestamp.now(),
      firstnameSearchableIndex,
      lastnameSearchableIndex,
      balance: 0,
      contributionBalance: 0,
      roles,
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

    // The bootstrap credential is deliberately random and never disclosed.
    // Members establish their own password through Firebase's reset flow.
    await admin.auth().createUser({
      email: member.email,
      password: createBootstrapPassword(),
      displayName: `${member.firstname} ${member.lastname}`,
      phoneNumber: member.phonenumber,
      uid,
    });

    await admin.auth().setCustomUserClaims(uid, {
      role: legacyRoleFor(roles),
      roles,
    });
    return null;
  },
);

export const deleteMember = onDocumentDeleted(
  {
    document: 'members/{memberId}',
    region: 'asia-south1',
  },
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

    await deleteCollection({ collectionPath: `members/${uid}/payments` });
    await deleteCollection({ collectionPath: `members/${uid}/contributions` });

    // delete account
    return admin.auth().deleteUser(uid);
  },
);

export const updateMember = onDocumentUpdated(
  {
    document: 'members/{memberId}',
    region: 'asia-south1',
  },
  async (event) => {
    const snapshots = event.data;
    const uid = snapshots?.after.id;

    if (!snapshots || !uid) return null;

    const memberBefore = memberData(snapshots.before);
    const memberAfter = memberData(snapshots.after);

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

    // if email is updated, update email
    if (memberBefore.email !== memberAfter.email) {
      await admin.auth().updateUser(uid, { email: memberAfter.email });
    }

    // Claims mirror the member's effective roles. assignMemberRoles also sets
    // them directly; this repairs claims if that step failed. Backfilling
    // `roles` from the legacy field leaves effective roles unchanged, so it
    // does not touch claims.
    const rolesBefore = memberRoles(snapshots.before.data());
    const rolesAfter = memberRoles(snapshots.after.data());
    if (!sameRoles(rolesBefore, rolesAfter)) {
      await admin.auth().setCustomUserClaims(uid, {
        role: legacyRoleFor(rolesAfter),
        roles: rolesAfter,
      });
    }

    return null;
  },
);
