import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import {
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, collectionGroup, deleteDoc, deleteField, doc, getDoc, getDocs, orderBy, query, setDoc, updateDoc, where } from 'firebase/firestore';

const projectId = 'demo-tmbwa';
let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterEach(async () => testEnv.clearFirestore());
afterAll(async () => testEnv.cleanup());

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    // Administrator access needs an active record that agrees with the claim.
    await setDoc(doc(db, 'members/admin'), {
      firstname: 'Ada',
      lastname: 'Admin',
      email: 'admin@example.test',
      role: 'administrator',
      roles: ['member', 'super_admin'],
      balance: 0,
      contributionBalance: 0,
      status: 'active',
    });
    await setDoc(doc(db, 'members/member-a'), {
      firstname: 'Alice',
      lastname: 'Member',
      email: 'alice@example.test',
      role: 'member',
      balance: 0,
      contributionBalance: 0,
      status: 'active',
    });
    await setDoc(doc(db, 'members/member-b'), {
      firstname: 'Bob',
      lastname: 'Member',
      email: 'bob@example.test',
      role: 'member',
      balance: 0,
      contributionBalance: 0,
      status: 'active',
    });
    await setDoc(doc(db, 'members/member-a/contributions/2026-08-01'), {
      amount: 500,
      balance: 500,
      month: '2026-08-01',
    });
    await setDoc(doc(db, 'members/member-a/payments/payment-1'), {
      amount: 100,
      paymentdate: new Date('2026-08-12T10:00:00+03:00'),
    });
    await setDoc(doc(db, 'members/member-a/notifications/notification-1'), {
      title: 'Payment received', body: 'Synthetic receipt', read: false,
    });
    await setDoc(doc(db, 'members/member-a/notification_preferences/default'), {
      inAppEnabled: true,
    });
    await setDoc(doc(db, 'monthly_stats/2026-08-01'), { amount: 1000 });
  });
}

describe('Firestore authorization', () => {
  it('denies unauthenticated reads and writes', async () => {
    await seed();
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'members/member-a')));
    await assertFails(setDoc(doc(db, 'members/new-member'), { role: 'member' }));
  });

  it('allows administrators to manage non-financial member fields and read reports', async () => {
    await seed();
    const db = testEnv.authenticatedContext('admin', {
      role: 'administrator',
    }).firestore();
    await assertSucceeds(getDocs(collection(db, 'members')));
    await assertSucceeds(updateDoc(doc(db, 'members/member-a'), { firstname: 'Alicia' }));
    await assertFails(updateDoc(doc(db, 'members/member-a'), { status: 'suspended' }));
    await assertSucceeds(getDoc(doc(db, 'monthly_stats/2026-08-01')));
  });

  it('keeps roles server-owned', async () => {
    await seed();
    const db = testEnv.authenticatedContext('admin', { role: 'administrator' }).firestore();
    const past = new Date('2020-03-15T09:00:00Z');
    await assertFails(updateDoc(doc(db, 'members/member-a'), { role: 'administrator' }));
    await assertFails(updateDoc(doc(db, 'members/member-a'), { roles: ['member', 'super_admin'] }));
    await assertFails(updateDoc(doc(db, 'members/admin'), { roles: ['member'] }));
    await assertFails(setDoc(doc(db, 'members/new-admin'), { role: 'administrator', datejoined: past }));
    await assertFails(setDoc(doc(db, 'members/new-officer'), {
      role: 'member', roles: ['member', 'treasurer'], datejoined: past,
    }));
    await assertSucceeds(setDoc(doc(db, 'members/new-member'), { role: 'member', datejoined: past }));
  });

  it('denies an administrator claim the member record no longer supports', async () => {
    await seed();
    const db = testEnv.authenticatedContext('admin', { role: 'administrator' }).firestore();
    const setAdmin = (fields: Record<string, unknown>) =>
      testEnv.withSecurityRulesDisabled(async (context) =>
        updateDoc(doc(context.firestore(), 'members/admin'), fields));

    await setAdmin({ role: 'member', roles: ['member'] });
    await assertFails(getDocs(collection(db, 'members')));
    await assertFails(getDoc(doc(db, 'members/member-a')));

    await setAdmin({ role: 'administrator', roles: ['member', 'super_admin'], status: 'suspended' });
    await assertFails(getDocs(collection(db, 'members')));
    await assertFails(getDoc(doc(db, 'monthly_stats/2026-08-01')));

    await testEnv.withSecurityRulesDisabled(async (context) =>
      deleteDoc(doc(context.firestore(), 'members/admin')));
    await assertFails(getDocs(collection(db, 'members')));
  });

  it('allows only administrators to set a valid date joined', async () => {
    await seed();
    const adminDb = testEnv.authenticatedContext('admin', { role: 'administrator' }).firestore();
    const memberDb = testEnv.authenticatedContext('member-a', { role: 'member' }).firestore();
    const past = new Date('2020-03-15T09:00:00Z');
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await assertSucceeds(updateDoc(doc(adminDb, 'members/member-a'), { datejoined: past }));
    await assertFails(updateDoc(doc(adminDb, 'members/member-a'), { datejoined: future }));
    await assertFails(updateDoc(doc(adminDb, 'members/member-a'), { datejoined: '2020-03-15' }));
    await assertFails(updateDoc(doc(memberDb, 'members/member-a'), { datejoined: new Date('2019-01-10T09:00:00Z') }));
    await assertSucceeds(setDoc(doc(adminDb, 'members/new-member'), { role: 'member', datejoined: past }));
    await assertFails(setDoc(doc(adminDb, 'members/future-member'), { role: 'member', datejoined: future }));
    await assertFails(setDoc(doc(adminDb, 'members/undated-member'), { role: 'member' }));
    await assertFails(updateDoc(doc(adminDb, 'members/member-a'), { datejoined: deleteField() }));
  });

  it('does not block administrator edits when a legacy date joined is malformed', async () => {
    await seed();
    await testEnv.withSecurityRulesDisabled(async (context) =>
      updateDoc(doc(context.firestore(), 'members/member-a'), { datejoined: 'legacy-text' }));
    const db = testEnv.authenticatedContext('admin', { role: 'administrator' }).firestore();
    await assertSucceeds(updateDoc(doc(db, 'members/member-a'), { firstname: 'Alicia' }));
  });

  it('denies direct administrator financial writes', async () => {
    await seed();
    const db = testEnv.authenticatedContext('admin', { role: 'administrator' }).firestore();
    await assertFails(updateDoc(doc(db, 'members/member-a'), { balance: 500 }));
    await assertFails(deleteDoc(doc(db, 'members/member-a')));
    await assertFails(deleteDoc(doc(db, 'members/member-a/payments/payment-1')));
    await assertFails(updateDoc(doc(db, 'monthly_stats/2026-08-01'), { amount: 0 }));
  });

  it('allows only administrators to run reporting collection-group queries', async () => {
    await seed();
    const adminDb = testEnv.authenticatedContext('admin', { role: 'administrator' }).firestore();
    const memberDb = testEnv.authenticatedContext('member-a', { role: 'member' }).firestore();
    await assertSucceeds(getDocs(query(collectionGroup(adminDb, 'contributions'), where('month', '==', '2026-08-01'), orderBy('month'))));
    await assertSucceeds(getDocs(query(collectionGroup(adminDb, 'payments'), orderBy('paymentdate', 'desc'))));
    await assertFails(getDocs(query(collectionGroup(memberDb, 'contributions'), orderBy('month'))));
    await assertFails(getDocs(query(collectionGroup(memberDb, 'payments'), orderBy('paymentdate', 'desc'))));
  });

  it('allows members to read their own profile and financial history', async () => {
    await seed();
    const db = testEnv.authenticatedContext('member-a', { role: 'member' }).firestore();
    await assertSucceeds(getDoc(doc(db, 'members/member-a')));
    await assertSucceeds(getDocs(collection(db, 'members/member-a/contributions')));
    await assertSucceeds(getDocs(collection(db, 'members/member-a/payments')));
  });

  it('denies cross-member reads and member listing', async () => {
    await seed();
    const db = testEnv.authenticatedContext('member-a', { role: 'member' }).firestore();
    await assertFails(getDoc(doc(db, 'members/member-b')));
    await assertFails(getDocs(collection(db, 'members')));
    await assertFails(getDocs(collection(db, 'members/member-b/payments')));
  });

  it('allows only approved self-profile fields', async () => {
    await seed();
    const db = testEnv.authenticatedContext('member-a', { role: 'member' }).firestore();
    await assertSucceeds(updateDoc(doc(db, 'members/member-a'), {
      firstname: 'Alicia',
      phonenumber: '+254700000000',
    }));
    await assertFails(updateDoc(doc(db, 'members/member-a'), { role: 'administrator' }));
    await assertFails(updateDoc(doc(db, 'members/member-a'), { balance: 100000 }));
  });

  it('denies an inactive owner even while an old token remains valid', async () => {
    await seed();
    await testEnv.withSecurityRulesDisabled(async (context) => updateDoc(doc(context.firestore(), 'members/member-a'), { status: 'suspended' }));
    const db = testEnv.authenticatedContext('member-a', { role: 'member' }).firestore();
    await assertFails(getDoc(doc(db, 'members/member-a')));
    await assertFails(getDocs(collection(db, 'members/member-a/contributions')));
    await assertFails(getDocs(collection(db, 'members/member-a/payments')));
    await assertFails(getDocs(collection(db, 'members/member-a/notifications')));
    await assertFails(getDoc(doc(db, 'members/member-a/notification_preferences/default')));
    await assertFails(updateDoc(doc(db, 'members/member-a/notifications/notification-1'), { read: true }));
    await assertFails(updateDoc(doc(db, 'members/member-a/notification_preferences/default'), { inAppEnabled: false }));
    await assertFails(updateDoc(doc(db, 'members/member-a'), { firstname: 'Still signed in' }));
  });

  it('denies all member financial and aggregate writes', async () => {
    await seed();
    const db = testEnv.authenticatedContext('member-a', { role: 'member' }).firestore();
    await assertFails(updateDoc(doc(db, 'members/member-a/contributions/2026-08-01'), { balance: 0 }));
    await assertFails(setDoc(doc(db, 'members/member-a/payments/payment-2'), { amount: 500 }));
    await assertFails(updateDoc(doc(db, 'monthly_stats/2026-08-01'), { amount: 0 }));
  });

  describe('beneficiaries', () => {
    const beneficiary = {
      firstname: 'Baraka',
      lastname: 'Member',
      relationship: 'son',
      dateOfBirth: '2015-04-20',
      requestId: 'request-initial',
      approvedBy: 'admin',
    };
    const changeRequest = (memberId: string) => ({
      memberId,
      type: 'annual',
      proposedBeneficiaries: [beneficiary],
      baseVersion: 1,
      status: 'pending',
      submittedBy: memberId,
    });

    async function seedBeneficiaries() {
      await seed();
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        for (const memberId of ['member-a', 'member-b']) {
          await setDoc(doc(db, `members/${memberId}/beneficiaries/beneficiary-1`), beneficiary);
          await setDoc(doc(db, `members/${memberId}/beneficiary_state/current`), {
            version: 1, lastAnnualChangeYear: null, pendingRequestId: `request-${memberId}`,
          });
          await setDoc(doc(db, `beneficiary_change_requests/request-${memberId}`), changeRequest(memberId));
        }
      });
    }

    it('allows an active owner to read only their own beneficiaries and requests', async () => {
      await seedBeneficiaries();
      const db = testEnv.authenticatedContext('member-a', { role: 'member' }).firestore();
      await assertSucceeds(getDocs(collection(db, 'members/member-a/beneficiaries')));
      await assertSucceeds(getDoc(doc(db, 'members/member-a/beneficiary_state/current')));
      await assertSucceeds(getDoc(doc(db, 'beneficiary_change_requests/request-member-a')));
      await assertSucceeds(getDocs(query(collection(db, 'beneficiary_change_requests'), where('memberId', '==', 'member-a'))));
      await assertFails(getDocs(collection(db, 'members/member-b/beneficiaries')));
      await assertFails(getDoc(doc(db, 'members/member-b/beneficiary_state/current')));
      await assertFails(getDoc(doc(db, 'beneficiary_change_requests/request-member-b')));
      await assertFails(getDocs(collection(db, 'beneficiary_change_requests')));
      await assertFails(getDocs(query(collection(db, 'beneficiary_change_requests'), where('memberId', '==', 'member-b'))));
    });

    it('allows administrators to read every member beneficiary and request', async () => {
      await seedBeneficiaries();
      const db = testEnv.authenticatedContext('admin', { role: 'administrator' }).firestore();
      await assertSucceeds(getDocs(collection(db, 'members/member-a/beneficiaries')));
      await assertSucceeds(getDoc(doc(db, 'members/member-b/beneficiary_state/current')));
      await assertSucceeds(getDocs(query(collection(db, 'beneficiary_change_requests'), where('status', '==', 'pending'))));
    });

    it('denies an inactive owner and unauthenticated users', async () => {
      await seedBeneficiaries();
      await testEnv.withSecurityRulesDisabled(async (context) =>
        updateDoc(doc(context.firestore(), 'members/member-a'), { status: 'inactive' }));
      const inactiveDb = testEnv.authenticatedContext('member-a', { role: 'member' }).firestore();
      await assertFails(getDocs(collection(inactiveDb, 'members/member-a/beneficiaries')));
      await assertFails(getDoc(doc(inactiveDb, 'members/member-a/beneficiary_state/current')));
      await assertFails(getDoc(doc(inactiveDb, 'beneficiary_change_requests/request-member-a')));
      await assertFails(getDocs(query(collection(inactiveDb, 'beneficiary_change_requests'), where('memberId', '==', 'member-a'))));
      const anonymousDb = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDocs(collection(anonymousDb, 'members/member-a/beneficiaries')));
      await assertFails(getDoc(doc(anonymousDb, 'beneficiary_change_requests/request-member-a')));
    });

    it('denies all client writes, including by administrators', async () => {
      await seedBeneficiaries();
      const memberDb = testEnv.authenticatedContext('member-a', { role: 'member' }).firestore();
      const adminDb = testEnv.authenticatedContext('admin', { role: 'administrator' }).firestore();
      for (const db of [memberDb, adminDb]) {
        await assertFails(setDoc(doc(db, 'members/member-a/beneficiaries/beneficiary-2'), beneficiary));
        await assertFails(updateDoc(doc(db, 'members/member-a/beneficiaries/beneficiary-1'), { firstname: 'Changed' }));
        await assertFails(deleteDoc(doc(db, 'members/member-a/beneficiaries/beneficiary-1')));
        await assertFails(updateDoc(doc(db, 'members/member-a/beneficiary_state/current'), { lastAnnualChangeYear: null, version: 0 }));
        await assertFails(setDoc(doc(db, 'beneficiary_change_requests/request-new'), changeRequest('member-a')));
        await assertFails(updateDoc(doc(db, 'beneficiary_change_requests/request-member-a'), { status: 'approved' }));
        await assertFails(deleteDoc(doc(db, 'beneficiary_change_requests/request-member-a')));
      }
    });
  });

  it('keeps STK payment locks server-only', async () => {
    await seed();
    const memberDb = testEnv.authenticatedContext('member-a', { role: 'member' }).firestore();
    const adminDb = testEnv.authenticatedContext('admin', { role: 'administrator' }).firestore();
    for (const db of [memberDb, adminDb]) {
      await assertFails(getDoc(doc(db, 'members/member-a/payment_locks/stk_top_up')));
      await assertFails(setDoc(doc(db, 'members/member-a/payment_locks/stk_top_up'), { status: 'failed' }));
    }
  });
});
