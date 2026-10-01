import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Runs against the Firestore emulator only (see `npm run test:integration`).
process.env.GCLOUD_PROJECT = 'demo-tmbwa';

const { admin } = await import('../functions/src/firebaseAdmin');
admin.initializeApp({ projectId: 'demo-tmbwa' });
const beneficiaries = await import('../functions/src/beneficiaries');
const financial = await import('../functions/src/financial');
const notifications = await import('../functions/src/notifications');

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
const approve = (requestId: string, data: Record<string, unknown> = {}, auth: unknown = adminAuth) =>
  call(beneficiaries.approveBeneficiaryChange, auth, { requestId, ...data });
const reject = (requestId: string, data: Record<string, unknown> = { reviewNote: 'Details incomplete' }, auth: unknown = adminAuth) =>
  call(beneficiaries.rejectBeneficiaryChange, auth, { requestId, ...data });
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
const notificationEvents = async () =>
  (await db().collection('notification_events').get()).docs.map((item) => item.data());
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
      memberId: MEMBER, type: 'initial', status: 'pending', baseVersion: 0, submittedBy: MEMBER, origin: 'member',
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

  it('does not return a retried request to a member who is no longer active', async () => {
    await submit(REQUEST);
    await seedMember(MEMBER, 'suspended');
    await expect(submit(REQUEST)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('refuses to reuse an administrator initial-entry ID for a member submission', async () => {
    await setInitial(REQUEST);
    await expect(submit(REQUEST)).rejects.toMatchObject({ code: 'already-exists' });
    expect(await requestDoc(REQUEST)).toMatchObject({ origin: 'administrator', status: 'approved' });
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

  it('does not return a retried cancellation to a member who is no longer active', async () => {
    await submit(REQUEST);
    await cancel(REQUEST);
    await seedMember(MEMBER, 'inactive');
    await expect(cancel(REQUEST)).rejects.toMatchObject({ code: 'permission-denied' });
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

  it('refuses to treat a member submission as an initial-entry retry', async () => {
    await submit(REQUEST);
    await expect(setInitial(REQUEST)).rejects.toMatchObject({ code: 'already-exists' });
    expect(await requestDoc(REQUEST)).toMatchObject({ origin: 'member', status: 'pending' });
    expect(await approvedBeneficiaries()).toEqual([]);

    // A cancelled or annual member request is not mistaken for one either.
    await cancel(REQUEST);
    await expect(setInitial(REQUEST)).rejects.toMatchObject({ code: 'already-exists' });
    await seedState({ version: 1, lastAnnualChangeYear: 2025 });
    await submit('request-annual-1');
    await expect(setInitial('request-annual-1')).rejects.toMatchObject({ code: 'already-exists' });
  });

  it('treats initial-entry ID reuse by another administrator as a conflict', async () => {
    await setInitial(REQUEST);
    await expect(setInitial(REQUEST, {}, { uid: 'admin-2', token: { role: 'administrator' } }))
      .rejects.toMatchObject({ code: 'already-exists' });
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

describe('approveBeneficiaryChange', () => {
  it('replaces the approved list and uses the annual allowance', async () => {
    await setInitial('request-initial-1');
    await submit(REQUEST, { beneficiaries: [beneficiary('Imani'), { ...beneficiary('Zawadi'), relationship: 'daughter' }] });
    await expect(approve(REQUEST, { reviewNote: ' Looks good ' })).resolves.toEqual({
      requestId: REQUEST, memberId: MEMBER, status: 'approved', duplicate: false,
    });

    const approved = await approvedBeneficiaries();
    expect(approved.map((item) => item.firstname).sort()).toEqual(['Imani', 'Zawadi']);
    expect(approved[0]).toMatchObject({ requestId: REQUEST, approvedBy: 'admin-1' });
    expect(await stateDoc()).toMatchObject({ version: 2, lastAnnualChangeYear: 2026, pendingRequestId: null });
    expect(await requestDoc(REQUEST)).toMatchObject({
      status: 'approved', reviewedBy: 'admin-1', reviewNote: 'Looks good',
    });

    const audit = (await auditEvents()).find((event) => event.action === 'beneficiary.change_approved');
    expect(audit).toMatchObject({
      actorId: 'admin-1', memberId: MEMBER, targetId: REQUEST,
      changes: { type: 'annual', beneficiaryCount: 2, version: 2, annualChangeYear: 2026 },
    });
    expect(JSON.stringify(audit)).not.toContain('Imani');
    expect(await notificationEvents()).toEqual([
      expect.objectContaining({ type: 'beneficiary.change_approved', memberId: MEMBER }),
    ]);

    // The annual change is now used, so the next one needs a reason.
    await expect(submit('request-000002')).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(submit('request-000002', { reason: { category: 'birth_or_adoption' } }))
      .resolves.toMatchObject({ type: 'exceptional' });
  });

  it('does not use the annual allowance for initial or exceptional changes', async () => {
    await submit(REQUEST);
    await approve(REQUEST);
    expect(await stateDoc()).toMatchObject({ version: 1, lastAnnualChangeYear: null });

    await seedState({ version: 1, lastAnnualChangeYear: 2026 });
    await submit('request-000002', { reason: { category: 'marriage' } });
    await approve('request-000002');
    expect(await stateDoc()).toMatchObject({ version: 2, lastAnnualChangeYear: 2026 });
    await seedState({ version: 2, lastAnnualChangeYear: 2025 });
    await expect(submit('request-000003')).resolves.toMatchObject({ type: 'annual' });
  });

  it('counts a December request approved in January against the year it was submitted', async () => {
    await seedState({ version: 1, lastAnnualChangeYear: 2025 });
    vi.setSystemTime(new Date('2026-12-30T10:00:00+03:00'));
    await submit(REQUEST);
    vi.setSystemTime(new Date('2027-01-04T10:00:00+03:00'));
    await approve(REQUEST);
    expect(await stateDoc()).toMatchObject({ lastAnnualChangeYear: 2026 });
    await expect(submit('request-000002')).resolves.toMatchObject({ type: 'annual' });
  });

  it('refuses a request made against an older approved list', async () => {
    await seedState({ version: 1 });
    await submit(REQUEST);
    await db().doc(`members/${MEMBER}/beneficiary_state/current`).update({ version: 2 });
    await expect(approve(REQUEST)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(await requestDoc(REQUEST)).toMatchObject({ status: 'pending' });
    expect(await approvedBeneficiaries()).toEqual([]);
  });

  it('is idempotent and refuses requests that are no longer pending', async () => {
    await submit(REQUEST);
    await approve(REQUEST);
    await expect(approve(REQUEST)).resolves.toMatchObject({ duplicate: true });
    await expect(reject(REQUEST)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(await notificationEvents()).toHaveLength(1);
    expect((await auditEvents()).filter((event) => event.action === 'beneficiary.change_approved')).toHaveLength(1);

    await submit('request-000002', { reason: { category: 'marriage' } });
    await cancel('request-000002');
    await expect(approve('request-000002')).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(approve('request-missing')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('records exactly one decision when administrators act at once', async () => {
    await submit(REQUEST);
    const results = await Promise.allSettled([
      approve(REQUEST),
      reject(REQUEST, { reviewNote: 'Duplicate request' }, { uid: 'admin-2', token: { role: 'administrator' } }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await notificationEvents()).toHaveLength(1);
    const decisions = (await auditEvents()).filter((event) => event.action !== 'beneficiary.change_requested');
    expect(decisions).toHaveLength(1);
  });

  it('refuses to approve a request from a deleted member, who can still be rejected', async () => {
    await submit(REQUEST);
    await call(financial.deleteMemberSafely, adminAuth, { requestId: 'delete-member-1', memberId: MEMBER });
    await expect(approve(REQUEST)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(await approvedBeneficiaries()).toEqual([]);
    expect(await requestDoc(REQUEST)).toMatchObject({ status: 'pending' });

    await expect(reject(REQUEST, { reviewNote: 'Member deleted' })).resolves.toMatchObject({ status: 'rejected' });
    expect(await notificationEvents()).toEqual([]);
  });

  it('requires an administrator', async () => {
    await submit(REQUEST);
    await expect(approve(REQUEST, {}, memberAuth())).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(approve(REQUEST, {}, null)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(approve(REQUEST, { reviewNote: 'x'.repeat(501) })).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});

describe('beneficiary decision notifications', () => {
  type Runnable = { run: (event: never) => Promise<unknown> };

  it('reach the member through the notification workers', async () => {
    await submit(REQUEST);
    await approve(REQUEST);
    await submit('request-000002', { reason: { category: 'marriage' } });
    await reject('request-000002');

    for (const event of (await db().collection('notification_events').get()).docs) {
      await (notifications.queueNotificationDeliveries as unknown as Runnable).run(
        { data: event, params: { eventId: event.id } } as never,
      );
    }
    await (notifications.processNotificationOutbox as unknown as Runnable).run({} as never);

    const delivered = (await db().collection(`members/${MEMBER}/notifications`).get()).docs.map((item) => item.data());
    expect(delivered.map((item) => item.title).sort()).toEqual([
      'Beneficiary change approved', 'Beneficiary change not approved',
    ]);
    expect(JSON.stringify(delivered)).not.toContain('Baraka');
  });
});

describe('rejectBeneficiaryChange', () => {
  it('keeps the approved list and the annual allowance', async () => {
    await setInitial('request-initial-1');
    await submit(REQUEST, { beneficiaries: [beneficiary('Imani')] });
    await expect(reject(REQUEST)).resolves.toMatchObject({ status: 'rejected', duplicate: false });

    expect((await approvedBeneficiaries()).map((item) => item.firstname).sort()).toEqual(['Baraka', 'Neema']);
    expect(await stateDoc()).toMatchObject({ version: 1, lastAnnualChangeYear: null, pendingRequestId: null });
    expect(await requestDoc(REQUEST)).toMatchObject({
      status: 'rejected', reviewedBy: 'admin-1', reviewNote: 'Details incomplete',
    });
    expect((await auditEvents()).find((event) => event.action === 'beneficiary.change_rejected'))
      .toMatchObject({ changes: { type: 'annual', beneficiaryCount: 1 } });
    expect(await notificationEvents()).toEqual([
      expect.objectContaining({ type: 'beneficiary.change_rejected', memberId: MEMBER }),
    ]);
    // The annual change is still available.
    await expect(submit('request-000002')).resolves.toMatchObject({ type: 'annual' });
  });

  it('requires a note and an administrator', async () => {
    await submit(REQUEST);
    await expect(reject(REQUEST, {})).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(reject(REQUEST, { reviewNote: '   ' })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(reject(REQUEST, undefined, memberAuth())).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await requestDoc(REQUEST)).toMatchObject({ status: 'pending' });
  });

  it('is idempotent for a retried rejection', async () => {
    await submit(REQUEST);
    await reject(REQUEST);
    await expect(reject(REQUEST)).resolves.toMatchObject({ duplicate: true });
    await expect(approve(REQUEST)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(await notificationEvents()).toHaveLength(1);
  });
});
