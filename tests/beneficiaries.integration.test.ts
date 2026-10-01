import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Runs against the Firestore emulator only (see `npm run test:integration`).
process.env.GCLOUD_PROJECT = 'demo-tmbwa';

const { admin } = await import('../functions/src/firebaseAdmin');
admin.initializeApp({ projectId: 'demo-tmbwa' });
const beneficiaries = await import('../functions/src/beneficiaries');

const db = () => admin.firestore();
const MEMBER = 'member-beneficiary';
const OTHER = 'member-other';

const adminAuth = { uid: 'admin-1', token: { role: 'administrator' } };
const memberAuth = (uid = MEMBER) => ({ uid, token: { role: 'member' } });

const beneficiary = (firstname = 'Baraka') => ({
  firstname,
  lastname: 'Synthetic',
  relationship: 'son',
  dateOfBirth: '2015-04-20',
  idnumber: '',
});

type Callable = { run: (request: never) => Promise<Record<string, unknown>> };
const call = (fn: unknown, auth: unknown, data: Record<string, unknown>) =>
  (fn as Callable).run({ auth, data, rawRequest: {} } as never);

const submit = (requestId: string, data: Record<string, unknown> = {}, auth: unknown = memberAuth()) =>
  call(beneficiaries.submitBeneficiaryChange, auth, {
    requestId, beneficiaries: [beneficiary()], ...data,
  });
const cancel = (requestId: string, auth: unknown = memberAuth()) =>
  call(beneficiaries.cancelBeneficiaryChange, auth, { requestId });
const setInitial = (requestId: string, data: Record<string, unknown> = {}, auth: unknown = adminAuth) =>
  call(beneficiaries.setInitialBeneficiaries, auth, {
    requestId, memberId: MEMBER, beneficiaries: [beneficiary(), beneficiary('Neema')], ...data,
  });

const seedMember = (id = MEMBER, status = 'active') =>
  db().doc(`members/${id}`).set({ firstname: 'Synthetic', lastname: 'Member', status, role: 'member' });
const seedState = (state: Record<string, unknown>, id = MEMBER) =>
  db().doc(`members/${id}/beneficiary_state/current`).set({
    version: 1, lastAnnualChangeYear: null, pendingRequestId: null, ...state,
  });

const stateDoc = async (id = MEMBER) => (await db().doc(`members/${id}/beneficiary_state/current`).get()).data();
const requestDoc = async (id: string) => (await db().doc(`beneficiary_change_requests/${id}`).get()).data();
const approvedBeneficiaries = async () =>
  (await db().collection(`members/${MEMBER}/beneficiaries`).get()).docs.map((item) => item.data());
const auditEvents = async () =>
  (await db().collection('audit_events').get()).docs.map((item) => item.data());

const clearFirestore = () =>
  fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-tmbwa/databases/(default)/documents`,
    { method: 'DELETE' },
  );

const REQUEST = 'request-000001';

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Run with the Firestore emulator: npm run test:integration');
  }
});

beforeEach(async () => {
  await clearFirestore();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-15T09:00:00+03:00'));
  await seedMember();
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await clearFirestore();
});

describe('submitBeneficiaryChange', () => {
  it('records a first submission as an initial pending request', async () => {
    await expect(submit(REQUEST)).resolves.toEqual({
      requestId: REQUEST, type: 'initial', status: 'pending', duplicate: false,
    });
    const request = await requestDoc(REQUEST);
    expect(request).toMatchObject({
      memberId: MEMBER, type: 'initial', status: 'pending', baseVersion: 0, submittedBy: MEMBER,
    });
    // Blank optional fields are not stored.
    expect(request?.proposedBeneficiaries[0]).not.toHaveProperty('idnumber');
    expect(await stateDoc()).toMatchObject({ version: 0, lastAnnualChangeYear: null, pendingRequestId: REQUEST });
    expect(await approvedBeneficiaries()).toEqual([]);

    const [audit] = await auditEvents();
    expect(audit).toMatchObject({
      action: 'beneficiary.change_requested', actorId: MEMBER, memberId: MEMBER, targetId: REQUEST,
      changes: { type: 'initial', beneficiaryCount: 1, baseVersion: 0 },
    });
    expect(JSON.stringify(audit)).not.toContain('Baraka');
  });

  it('records an annual request when the allowance is unused this year', async () => {
    await seedState({ version: 1, lastAnnualChangeYear: 2025 });
    await expect(submit(REQUEST)).resolves.toMatchObject({ type: 'annual' });
    expect(await requestDoc(REQUEST)).toMatchObject({ baseVersion: 1 });
  });

  it('requires a reason once this year\'s annual change is used', async () => {
    await seedState({ lastAnnualChangeYear: 2026 });
    await expect(submit(REQUEST)).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(submit(REQUEST, { reason: { category: 'other', text: '' } }))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(submit(REQUEST, { reason: { category: 'marriage' } }))
      .resolves.toMatchObject({ type: 'exceptional' });
    expect(await requestDoc(REQUEST)).toMatchObject({ reason: { category: 'marriage' } });
    expect((await auditEvents())[0].changes).toMatchObject({ reasonCategory: 'marriage' });
  });

  it('allows the annual change again from 1 January, Nairobi time', async () => {
    await seedState({ lastAnnualChangeYear: 2026 });
    vi.setSystemTime(new Date('2026-12-31T23:59:00+03:00'));
    await expect(submit(REQUEST)).rejects.toMatchObject({ code: 'failed-precondition' });
    vi.setSystemTime(new Date('2027-01-01T00:01:00+03:00'));
    await expect(submit(REQUEST)).resolves.toMatchObject({ type: 'annual' });
  });

  it('rejects more than three beneficiaries and invalid details', async () => {
    const four = ['A', 'B', 'C', 'D'].map((name) => beneficiary(name));
    await expect(submit(REQUEST, { beneficiaries: four })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(submit(REQUEST, { beneficiaries: [{ ...beneficiary(), dateOfBirth: '2099-01-01' }] }))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(submit(REQUEST, { beneficiaries: [] })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(submit('../../members/x')).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(await requestDoc(REQUEST)).toBeUndefined();
  });

  it('ignores a client-supplied request type', async () => {
    await seedState({ lastAnnualChangeYear: 2026 });
    await expect(submit(REQUEST, { type: 'initial' })).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects a second pending request', async () => {
    await submit(REQUEST);
    await expect(submit('request-000002')).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('is idempotent for a retried request', async () => {
    await submit(REQUEST);
    await expect(submit(REQUEST)).resolves.toMatchObject({ duplicate: true, status: 'pending' });
    expect(await auditEvents()).toHaveLength(1);
  });

  it('refuses a request ID that belongs to another member', async () => {
    await seedMember(OTHER);
    await submit(REQUEST, {}, memberAuth(OTHER));
    await expect(submit(REQUEST)).rejects.toMatchObject({ code: 'already-exists' });
  });

  it('accepts only one of two simultaneous submissions', async () => {
    const results = await Promise.allSettled([submit('request-race-1'), submit('request-race-2')]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const pending = await db().collection('beneficiary_change_requests').where('status', '==', 'pending').get();
    expect(pending.size).toBe(1);
    expect((await stateDoc())?.pendingRequestId).toBe(pending.docs[0].id);
  });

  it('rejects inactive and signed-out callers', async () => {
    await seedMember(MEMBER, 'inactive');
    await expect(submit(REQUEST)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(submit(REQUEST, {}, null)).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});

describe('cancelBeneficiaryChange', () => {
  it('cancels a pending request without using the annual allowance', async () => {
    await seedState({ version: 1, lastAnnualChangeYear: 2025 });
    await submit(REQUEST);
    await expect(cancel(REQUEST)).resolves.toMatchObject({ status: 'cancelled', duplicate: false });
    expect(await requestDoc(REQUEST)).toMatchObject({ status: 'cancelled' });
    expect(await stateDoc()).toMatchObject({ version: 1, lastAnnualChangeYear: 2025, pendingRequestId: null });
    // The annual change is still available.
    await expect(submit('request-000002')).resolves.toMatchObject({ type: 'annual' });
    expect((await auditEvents()).map((audit) => audit.action).sort()).toEqual([
      'beneficiary.change_cancelled', 'beneficiary.change_requested', 'beneficiary.change_requested',
    ]);
  });

  it('is idempotent for a retried cancellation', async () => {
    await submit(REQUEST);
    await cancel(REQUEST);
    await expect(cancel(REQUEST)).resolves.toMatchObject({ duplicate: true });
    expect(await auditEvents()).toHaveLength(2);
  });

  it('does not let another member cancel or discover a request', async () => {
    await seedMember(OTHER);
    await submit(REQUEST);
    await expect(cancel(REQUEST, memberAuth(OTHER))).rejects.toMatchObject({ code: 'not-found' });
    await expect(cancel('request-missing')).rejects.toMatchObject({ code: 'not-found' });
    expect(await requestDoc(REQUEST)).toMatchObject({ status: 'pending' });
  });

  it('rejects cancellation by an inactive member', async () => {
    await submit(REQUEST);
    await seedMember(MEMBER, 'suspended');
    await expect(cancel(REQUEST)).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('setInitialBeneficiaries', () => {
  it('records approved beneficiaries directly without using the annual allowance', async () => {
    await expect(setInitial(REQUEST)).resolves.toMatchObject({ type: 'initial', status: 'approved' });
    expect(await approvedBeneficiaries()).toHaveLength(2);
    expect((await approvedBeneficiaries())[0]).toMatchObject({ requestId: REQUEST, approvedBy: 'admin-1' });
    expect(await stateDoc()).toMatchObject({ version: 1, lastAnnualChangeYear: null, pendingRequestId: null });
    expect(await requestDoc(REQUEST)).toMatchObject({
      type: 'initial', status: 'approved', submittedBy: 'admin-1', reviewedBy: 'admin-1',
    });
    expect((await auditEvents())[0]).toMatchObject({
      action: 'beneficiary.initial_set', actorId: 'admin-1', changes: { beneficiaryCount: 2, version: 1 },
    });
    // The member's first change afterwards is their annual change.
    await expect(submit('request-000002')).resolves.toMatchObject({ type: 'annual' });
  });

  it('is idempotent for a retried request', async () => {
    await setInitial(REQUEST);
    await expect(setInitial(REQUEST)).resolves.toMatchObject({ duplicate: true });
    expect(await approvedBeneficiaries()).toHaveLength(2);
  });

  it('refuses when the member already has beneficiaries or a pending request', async () => {
    await setInitial(REQUEST);
    await expect(setInitial('request-000002')).rejects.toMatchObject({ code: 'failed-precondition' });

    await clearFirestore();
    await seedMember();
    await submit('request-000003');
    await expect(setInitial('request-000004')).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('requires an administrator and an existing member', async () => {
    await expect(setInitial(REQUEST, {}, memberAuth())).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(setInitial(REQUEST, { memberId: 'missing-member' })).rejects.toMatchObject({ code: 'not-found' });
    await expect(setInitial(REQUEST, { beneficiaries: [] })).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});
