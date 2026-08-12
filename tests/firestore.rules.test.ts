import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import {
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, orderBy, query, setDoc, updateDoc, where } from 'firebase/firestore';

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
    await assertSucceeds(updateDoc(doc(db, 'members/member-a'), { role: 'administrator' }));
    await assertFails(updateDoc(doc(db, 'members/member-a'), { status: 'suspended' }));
    await assertSucceeds(getDoc(doc(db, 'monthly_stats/2026-08-01')));
  });

  it('denies direct administrator financial writes', async () => {
    await seed();
    const db = testEnv.authenticatedContext('admin', { role: 'administrator' }).firestore();
    await assertFails(updateDoc(doc(db, 'members/member-a'), { balance: 500 }));
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
    await assertFails(updateDoc(doc(db, 'members/member-a'), { firstname: 'Still signed in' }));
  });

  it('denies all member financial and aggregate writes', async () => {
    await seed();
    const db = testEnv.authenticatedContext('member-a', { role: 'member' }).firestore();
    await assertFails(updateDoc(doc(db, 'members/member-a/contributions/2026-08-01'), { balance: 0 }));
    await assertFails(setDoc(doc(db, 'members/member-a/payments/payment-2'), { amount: 500 }));
    await assertFails(updateDoc(doc(db, 'monthly_stats/2026-08-01'), { amount: 0 }));
  });
});
