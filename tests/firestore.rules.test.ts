import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import {
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { Firestore, collection, collectionGroup, deleteDoc, deleteField, doc, getDoc, getDocs, orderBy, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { normalizeRoles, roleHasPermission, roles, type Permission, type Role } from 'tmbwa-shared';

// The payload addMember sends for a new member.
const newMember = (datejoined: unknown, overrides: Record<string, unknown> = {}) => ({
  firstname: 'Nia', lastname: 'New', membernumber: '0002/26', win: 'WIN-2',
  phonenumber: '+254712345679', gender: 'female', email: 'nia@example.test',
  isFeesPaid: false, datejoined, status: 'active',
  balance: 0, contributionBalance: 0, reservedKcbCredit: 0, ...overrides,
});

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
    // Officer access needs an active record that agrees with the claim.
    await setDoc(doc(db, 'members/admin'), {
      firstname: 'Ada',
      lastname: 'Admin',
      email: 'admin@example.test',
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
    const db = testEnv.authenticatedContext('admin', { roles: ['super_admin'] }).firestore();
    await assertSucceeds(getDocs(collection(db, 'members')));
    await assertSucceeds(updateDoc(doc(db, 'members/member-a'), { firstname: 'Alicia' }));
    await assertFails(updateDoc(doc(db, 'members/member-a'), { status: 'suspended' }));
    await assertSucceeds(getDoc(doc(db, 'monthly_stats/2026-08-01')));
  });

  it('keeps roles server-owned', async () => {
    await seed();
    const db = testEnv.authenticatedContext('admin', { roles: ['super_admin'] }).firestore();
    const past = new Date('2020-03-15T09:00:00Z');
    await assertFails(updateDoc(doc(db, 'members/member-a'), { role: 'administrator' }));
    await assertFails(updateDoc(doc(db, 'members/member-a'), { roles: ['member', 'super_admin'] }));
    await assertFails(updateDoc(doc(db, 'members/admin'), { roles: ['member'] }));
    await assertFails(setDoc(doc(db, 'members/new-admin'), newMember(past, { role: 'administrator' })));
    await assertFails(setDoc(doc(db, 'members/new-officer'), newMember(past, { roles: ['member', 'treasurer'] })));
    await assertSucceeds(setDoc(doc(db, 'members/new-member'), newMember(past)));
  });

  it('keeps phoneNormalized server-owned', async () => {
    await seed();
    const adminDb = testEnv.authenticatedContext('admin', { roles: ['super_admin'] }).firestore();
    const memberDb = testEnv.authenticatedContext('member-a', { role: 'member' }).firestore();
    const past = new Date('2020-03-15T09:00:00Z');
    const phoneNormalized = '+254712345679';
    await assertFails(setDoc(doc(adminDb, 'members/new-member'), newMember(past, { phoneNormalized })));
    await assertFails(updateDoc(doc(adminDb, 'members/member-a'), { phoneNormalized }));
    await assertFails(updateDoc(doc(adminDb, 'members/member-a'), { phonenumber: '0712345679', phoneNormalized }));
    await assertFails(updateDoc(doc(memberDb, 'members/member-a'), { phoneNormalized }));
    await assertFails(updateDoc(doc(memberDb, 'members/member-a'), { phonenumber: '0712345679', phoneNormalized }));
    await testEnv.withSecurityRulesDisabled(async (context) =>
      updateDoc(doc(context.firestore(), 'members/member-a'), { phoneNormalized }));
    await assertFails(updateDoc(doc(adminDb, 'members/member-a'), { phoneNormalized: deleteField() }));
    await assertFails(updateDoc(doc(memberDb, 'members/member-a'), { phoneNormalized: deleteField() }));
    // The profile phone itself stays editable; Functions update the copy.
    await assertSucceeds(updateDoc(doc(memberDb, 'members/member-a'), { phonenumber: '0712345670' }));
    await assertSucceeds(setDoc(doc(adminDb, 'members/new-member'), newMember(past)));
  });

  it('denies a super admin claim the member record no longer supports', async () => {
    await seed();
    const db = testEnv.authenticatedContext('admin', { roles: ['super_admin'] }).firestore();
    const setAdmin = (fields: Record<string, unknown>) =>
      testEnv.withSecurityRulesDisabled(async (context) =>
        updateDoc(doc(context.firestore(), 'members/admin'), fields));

    await setAdmin({ roles: ['member'] });
    await assertFails(getDocs(collection(db, 'members')));
    await assertFails(getDoc(doc(db, 'members/member-a')));

    await setAdmin({ roles: ['member', 'super_admin'], status: 'suspended' });
    await assertFails(getDocs(collection(db, 'members')));
    await assertFails(getDoc(doc(db, 'monthly_stats/2026-08-01')));

    await testEnv.withSecurityRulesDisabled(async (context) =>
      deleteDoc(doc(context.firestore(), 'members/admin')));
    await assertFails(getDocs(collection(db, 'members')));
  });

  it('allows only administrators to set a valid date joined', async () => {
    await seed();
    const adminDb = testEnv.authenticatedContext('admin', { roles: ['super_admin'] }).firestore();
    const memberDb = testEnv.authenticatedContext('member-a', { role: 'member' }).firestore();
    const past = new Date('2020-03-15T09:00:00Z');
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await assertSucceeds(updateDoc(doc(adminDb, 'members/member-a'), { datejoined: past }));
    await assertFails(updateDoc(doc(adminDb, 'members/member-a'), { datejoined: future }));
    await assertFails(updateDoc(doc(adminDb, 'members/member-a'), { datejoined: '2020-03-15' }));
    await assertFails(updateDoc(doc(memberDb, 'members/member-a'), { datejoined: new Date('2019-01-10T09:00:00Z') }));
    await assertSucceeds(setDoc(doc(adminDb, 'members/new-member'), newMember(past)));
    await assertFails(setDoc(doc(adminDb, 'members/future-member'), newMember(future)));
    const undated: Record<string, unknown> = newMember(past);
    delete undated.datejoined;
    await assertFails(setDoc(doc(adminDb, 'members/undated-member'), undated));
    await assertFails(updateDoc(doc(adminDb, 'members/member-a'), { datejoined: deleteField() }));
  });

  it('does not block administrator edits when a legacy date joined is malformed', async () => {
    await seed();
    await testEnv.withSecurityRulesDisabled(async (context) =>
      updateDoc(doc(context.firestore(), 'members/member-a'), { datejoined: 'legacy-text' }));
    const db = testEnv.authenticatedContext('admin', { roles: ['super_admin'] }).firestore();
    await assertSucceeds(updateDoc(doc(db, 'members/member-a'), { firstname: 'Alicia' }));
  });

  it('denies direct administrator financial writes', async () => {
    await seed();
    const db = testEnv.authenticatedContext('admin', { roles: ['super_admin'] }).firestore();
    await assertFails(updateDoc(doc(db, 'members/member-a'), { balance: 500 }));
    await assertFails(deleteDoc(doc(db, 'members/member-a')));
    await assertFails(deleteDoc(doc(db, 'members/member-a/payments/payment-1')));
    // Statement imports match on this server-owned field.
    await assertFails(updateDoc(doc(db, 'members/member-a/payments/payment-1'), { referenceNormalized: 'TD11AAAAAA' }));
    await assertFails(updateDoc(doc(db, 'monthly_stats/2026-08-01'), { amount: 0 }));
  });

  it('allows only administrators to run reporting collection-group queries', async () => {
    await seed();
    const adminDb = testEnv.authenticatedContext('admin', { roles: ['super_admin'] }).firestore();
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
    await assertFails(updateDoc(doc(db, 'members/member-a/payments/payment-1'), { referenceNormalized: 'TD11AAAAAA' }));
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
      const db = testEnv.authenticatedContext('admin', { roles: ['super_admin'] }).firestore();
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
      const adminDb = testEnv.authenticatedContext('admin', { roles: ['super_admin'] }).firestore();
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
    const adminDb = testEnv.authenticatedContext('admin', { roles: ['super_admin'] }).firestore();
    for (const db of [memberDb, adminDb]) {
      await assertFails(getDoc(doc(db, 'members/member-a/payment_locks/stk_top_up')));
      await assertFails(setDoc(doc(db, 'members/member-a/payment_locks/stk_top_up'), { status: 'failed' }));
    }
  });
});

describe('role-based access', () => {
  const OFFICER = 'officer';
  const past = new Date('2020-03-15T09:00:00Z');

  async function seedOfficer(roles: Role[], status = 'active') {
    await seed();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const held = normalizeRoles(roles);
      await setDoc(doc(db, `members/${OFFICER}`), {
        firstname: 'Olive', lastname: 'Officer', email: 'officer@example.test',
        roles: held, status, balance: 0, contributionBalance: 0,
      });
      await setDoc(doc(db, 'members/member-a/beneficiaries/beneficiary-1'), { firstname: 'Baraka' });
      await setDoc(doc(db, 'members/member-a/beneficiary_state/current'), { version: 1 });
      await setDoc(doc(db, 'beneficiary_change_requests/request-a'), { memberId: 'member-a', status: 'pending' });
      await setDoc(doc(db, 'stats/--stats--'), { totalMembers: 2 });
      await setDoc(doc(db, 'audit_events/event-1'), { action: 'payment.reversed', memberId: 'member-a' });
      await setDoc(doc(db, 'kcb_payment_notifications/R-1'), { status: 'unresolved', amount: 500 });
      await setDoc(doc(db, 'kcb_stk_requests/stk-1'), { memberId: 'member-a', status: 'pending' });
      await setDoc(doc(db, 'notification_events/event-1'), { memberId: 'member-a' });
      await setDoc(doc(db, 'notification_deliveries/delivery-1'), { memberId: 'member-a' });
      await setDoc(doc(db, 'contribution_rates/rate-1'), { amount: 500, effectiveFrom: '2026-01-01' });
    });
  }

  const officerDb = (roles: Role[]) => {
    const held = normalizeRoles(roles);
    return testEnv.authenticatedContext(OFFICER, { roles: held }).firestore();
  };

  // Every client access an officer might attempt, with the permission that governs it.
  const checks: [string, Permission, (db: Firestore) => Promise<unknown>][] = [
    ['read a member', 'members.read', (db) => getDoc(doc(db, 'members/member-a'))],
    ['list members', 'members.read', (db) => getDocs(collection(db, 'members'))],
    ['edit member details', 'members.write', (db) => updateDoc(doc(db, 'members/member-a'), { firstname: 'Alicia' })],
    ['add a member', 'members.write', (db) => setDoc(doc(db, 'members/new-member'), newMember(past))],
    ['read contributions', 'payments.read', (db) => getDocs(collection(db, 'members/member-a/contributions'))],
    ['read payments', 'payments.read', (db) => getDocs(collection(db, 'members/member-a/payments'))],
    ['query all contributions', 'payments.read', (db) => getDocs(query(collectionGroup(db, 'contributions'), orderBy('month')))],
    ['query all payments', 'payments.read', (db) => getDocs(query(collectionGroup(db, 'payments'), orderBy('paymentdate', 'desc')))],
    ['read KCB payments', 'payments.read', (db) => getDocs(collection(db, 'kcb_payment_notifications'))],
    ['read STK requests', 'payments.read', (db) => getDoc(doc(db, 'kcb_stk_requests/stk-1'))],
    ['read contribution rates', 'payments.read', (db) => getDocs(collection(db, 'contribution_rates'))],
    ['read monthly statistics', 'reports.read', (db) => getDoc(doc(db, 'monthly_stats/2026-08-01'))],
    ['read statistics', 'reports.read', (db) => getDoc(doc(db, 'stats/--stats--'))],
    ['read the audit log', 'audit.read', (db) => getDocs(collection(db, 'audit_events'))],
    ['read beneficiaries', 'beneficiaries.read', (db) => getDocs(collection(db, 'members/member-a/beneficiaries'))],
    ['read beneficiary state', 'beneficiaries.read', (db) => getDoc(doc(db, 'members/member-a/beneficiary_state/current'))],
    ['list beneficiary requests', 'beneficiaries.read', (db) => getDocs(collection(db, 'beneficiary_change_requests'))],
    ['read notification deliveries', 'notifications.retry', (db) => getDocs(collection(db, 'notification_deliveries'))],
    ['read notification events', 'notifications.retry', (db) => getDoc(doc(db, 'notification_events/event-1'))],
    ['read member notifications', 'notifications.retry', (db) => getDocs(collection(db, 'members/member-a/notifications'))],
    ['set a contribution rate', 'rates.manage', (db) => setDoc(doc(db, 'contribution_rates/rate-2'), { amount: 600, effectiveFrom: '2027-01-01' })],
  ];

  const officerRoles = roles.filter((role) => role !== 'member');
  const cases = officerRoles.flatMap((role) =>
    checks.map(([label, permission, attempt]) => ({
      role,
      label,
      attempt,
      allowed: roleHasPermission([role], permission),
    })),
  );

  it.each(cases)('$role: $label → allowed $allowed', async ({ role, attempt, allowed }) => {
    await seedOfficer([role]);
    const result = attempt(officerDb([role]));
    await (allowed ? assertSucceeds(result) : assertFails(result));
  });

  it('lets a registrar create a member but not seed server-owned fields', async () => {
    await seedOfficer(['registrar']);
    const db = officerDb(['registrar']);
    await assertSucceeds(setDoc(doc(db, 'members/new-member'), newMember(past)));
    const forged: Record<string, unknown>[] = [
      { reservedKcbCredit: 100000 },
      { balance: 5000 },
      { contributionBalance: 5000 },
      { status: 'suspended' },
      { role: 'administrator' },
      { roles: ['member', 'treasurer'] },
      { createat: new Date() },
      { firstnameSearchableIndex: { n: true } },
      { rolesUpdatedBy: OFFICER },
      { statusUpdatedBy: OFFICER },
    ];
    for (const fields of forged) {
      await assertFails(setDoc(doc(db, 'members/forged-member'), newMember(past, fields)));
    }
  });

  it('never lets an auditor read beneficiary personal data', async () => {
    await seedOfficer(['auditor']);
    const db = officerDb(['auditor']);
    await assertFails(getDocs(collection(db, 'members/member-a/beneficiaries')));
    await assertFails(getDoc(doc(db, 'members/member-a/beneficiaries/beneficiary-1')));
    await assertFails(getDoc(doc(db, 'members/member-a/beneficiary_state/current')));
    await assertFails(getDoc(doc(db, 'beneficiary_change_requests/request-a')));
    await assertFails(getDocs(collection(db, 'beneficiary_change_requests')));
    await assertFails(getDocs(query(collection(db, 'beneficiary_change_requests'), where('memberId', '==', 'member-a'))));
  });

  it('lets a registrar who is also a welfare officer manage members and beneficiaries but nothing financial', async () => {
    const both: Role[] = ['registrar', 'welfare_officer'];
    await seedOfficer(both);
    const db = officerDb(both);
    await assertSucceeds(updateDoc(doc(db, 'members/member-a'), { firstname: 'Alicia' }));
    await assertSucceeds(getDocs(collection(db, 'members/member-a/beneficiaries')));
    await assertSucceeds(getDocs(collection(db, 'beneficiary_change_requests')));
    await assertFails(getDocs(collection(db, 'members/member-a/payments')));
    await assertFails(getDocs(collection(db, 'audit_events')));
    await assertFails(getDoc(doc(db, 'monthly_stats/2026-08-01')));
  });

  it('requires the token and the member record to agree', async () => {
    // The record now says auditor; the token still claims treasurer. Only a
    // role both grant counts, so the officer has no officer access at all.
    await seedOfficer(['auditor']);
    const stale = officerDb(['treasurer']);
    await assertFails(getDocs(collection(stale, 'members/member-a/payments')));
    await assertFails(getDocs(collection(stale, 'audit_events')));
    await assertFails(getDocs(collection(stale, 'kcb_payment_notifications')));
    await assertFails(getDocs(collection(stale, 'members')));
  });

  it('denies a suspended officer', async () => {
    await seedOfficer(['treasurer'], 'suspended');
    const db = officerDb(['treasurer']);
    await assertFails(getDocs(collection(db, 'members')));
    await assertFails(getDocs(collection(db, 'members/member-a/payments')));
  });

  it('grants nothing for the retired administrator claim or record field', async () => {
    await seed();
    await testEnv.withSecurityRulesDisabled(async (context) =>
      setDoc(doc(context.firestore(), 'members/legacy-admin'), { role: 'administrator', status: 'active' }));
    // A retired claim with a record that still carries roles.
    const claimOnly = testEnv.authenticatedContext('admin', { role: 'administrator' }).firestore();
    // A current claim with a record that only carries the retired field.
    const fieldOnly = testEnv.authenticatedContext('legacy-admin', { roles: ['super_admin'] }).firestore();
    for (const db of [claimOnly, fieldOnly]) {
      await assertFails(getDocs(collection(db, 'members')));
      await assertFails(getDocs(collection(db, 'members/member-a/beneficiaries')));
      await assertFails(getDocs(collection(db, 'audit_events')));
    }
  });
});
