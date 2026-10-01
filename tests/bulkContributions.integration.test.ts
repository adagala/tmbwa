import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Runs against the Firestore emulator only (see `npm run test:integration`).
process.env.GCLOUD_PROJECT = 'demo-tmbwa';

const { admin } = await import('../functions/src/firebaseAdmin');
admin.initializeApp({ projectId: 'demo-tmbwa' });
const financial = await import('../functions/src/financial');

const db = () => admin.firestore();
const MEMBER = 'member-bulk';
const REQUEST = 'bulk-request-1';

const memberFields = {
  firstname: 'Bob',
  lastname: 'Member',
  membernumber: '4321/24',
  win: 'WIN-2',
  phonenumber: '0712345679',
  gender: 'male',
  email: 'bob@example.test',
  role: 'member',
  isFeesPaid: true,
};

const seedMember = (overrides: Record<string, unknown> = {}) =>
  db()
    .doc(`members/${MEMBER}`)
    .set({
      ...memberFields,
      status: 'active',
      balance: 0,
      contributionBalance: 0,
      reservedKcbCredit: 0,
      datejoined: admin.firestore.Timestamp.fromDate(new Date('2026-06-10T09:00:00+03:00')),
      ...overrides,
    });

const seedContribution = (id: string) =>
  db()
    .doc(`members/${MEMBER}/contributions/${id}`)
    .set({
      ...memberFields,
      status: 'active',
      balance: 0,
      contributionBalance: 0,
      member_id: MEMBER,
      contribution_id: id,
      month: id,
      amount: 500,
      paid: 'paid',
      payments: [],
    });

const memberDoc = async () => (await db().doc(`members/${MEMBER}`).get()).data()!;
const contributionDoc = async (month: string) =>
  (await db().doc(`members/${MEMBER}/contributions/${month}`).get()).data();
const contributionIds = async () =>
  (await db().collection(`members/${MEMBER}/contributions`).get()).docs.map((item) => item.id);
const payments = async () =>
  (await db().collection(`members/${MEMBER}/payments`).get()).docs.map((item) => item.data());

const adminAuth = { uid: 'admin-1', token: { role: 'administrator' } };
const memberAuth = { uid: MEMBER, token: { role: 'member' } };
// Officers must hold an active member record to act.
const seedOfficers = (...uids: string[]) =>
  Promise.all(uids.map((uid) => db().doc(`members/${uid}`).set({ status: 'active', role: 'administrator' })));

const createContributions = (
  months: unknown,
  auth: unknown = adminAuth,
  requestId = REQUEST,
) =>
  (financial.createContributions as unknown as { run: (request: never) => unknown }).run({
    auth,
    data: { requestId, memberId: MEMBER, months },
    rawRequest: {},
  } as never) as Promise<Record<string, unknown>>;

const clearFirestore = () =>
  fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-tmbwa/databases/(default)/documents`,
    { method: 'DELETE' },
  );

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Run with the Firestore emulator: npm run test:integration');
  }
});

beforeEach(async () => {
  await clearFirestore();
  await seedOfficers(adminAuth.uid);
  // Only Date is faked so the Firestore client's timers keep working.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-15T09:00:00+03:00'));
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await clearFirestore();
});

describe('bulk missing contributions', () => {
  it('bills the selected months oldest first and applies credit to the oldest', async () => {
    await seedMember({ balance: 700 });
    await seedContribution('2026-07-01');

    const result = await createContributions(['2026-09-01', '2026-06-01', '2026-08-01']);
    expect(result).toMatchObject({
      duplicate: false,
      months: ['2026-06-01', '2026-08-01', '2026-09-01'],
      amount: 1500,
      appliedFromBalance: 700,
    });

    expect(await contributionDoc('2026-06-01')).toMatchObject({ balance: 0, paid: 'paid' });
    expect(await contributionDoc('2026-08-01')).toMatchObject({ balance: 300, paid: 'partial' });
    expect(await contributionDoc('2026-09-01')).toMatchObject({ balance: 500, paid: 'unpaid' });
    expect(await memberDoc()).toMatchObject({ balance: -800, contributionBalance: 700 });

    const balancePayments = await payments();
    expect(
      balancePayments
        .map((payment) => [payment.contribution_id, payment.amount])
        .sort(),
    ).toEqual([
      ['2026-06-01', 500],
      ['2026-08-01', 200],
    ]);
    expect((await db().doc('monthly_stats/2026-08-01').get()).data()).toMatchObject({
      amount: 500,
      contribution: 200,
      paymentsCount: 1,
    });

    const audits = (await db().collection('audit_events').get()).docs.map((item) => item.data());
    expect(audits.map((audit) => audit.targetId).sort()).toEqual([
      '2026-06-01',
      '2026-08-01',
      '2026-09-01',
    ]);
    expect(audits.every((audit) => audit.action === 'contribution.created')).toBe(true);
    expect(audits.every((audit) => audit.actorId === 'admin-1')).toBe(true);

    const notifications = (await db().collection('notification_events').get()).docs.map((item) =>
      item.data(),
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      type: 'contributions.created',
      contributionIds: ['2026-06-01', '2026-08-01', '2026-09-01'],
      amount: 1500,
      balance: 800,
    });
  });

  it('ignores a retry of the same request', async () => {
    await seedMember();
    await createContributions(['2026-06-01', '2026-07-01']);
    expect(await createContributions(['2026-06-01', '2026-07-01'])).toMatchObject({
      duplicate: true,
    });
    expect((await contributionIds()).sort()).toEqual(['2026-06-01', '2026-07-01']);
    expect((await memberDoc()).balance).toBe(-1000);
  });

  it('writes nothing when any selected month is already billed, including legacy ids', async () => {
    await seedMember({ balance: 500 });
    await seedContribution('2026-08');

    await expect(createContributions(['2026-07-01', '2026-08-01'])).rejects.toMatchObject({
      code: 'invalid-argument',
      message: expect.stringContaining('2026-08-01'),
    });
    expect(await contributionIds()).toEqual(['2026-08']);
    expect(await memberDoc()).toMatchObject({ balance: 500, contributionBalance: 0 });
    expect(await payments()).toHaveLength(0);
    expect((await db().doc(`financial_commands/${REQUEST}`).get()).exists).toBe(false);
  });

  it('rejects months before the join month or after the current month', async () => {
    await seedMember();
    await expect(createContributions(['2026-05-01'])).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    await expect(createContributions(['2026-10-01'])).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect(await contributionIds()).toEqual([]);
  });

  it('falls back to createat when datejoined is missing', async () => {
    await seedMember({
      createat: admin.firestore.Timestamp.fromDate(new Date('2026-08-20T09:00:00+03:00')),
    });
    await db().doc(`members/${MEMBER}`).update({ datejoined: admin.firestore.FieldValue.delete() });
    await expect(createContributions(['2026-07-01'])).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    await createContributions(['2026-08-01'], adminAuth, 'bulk-request-createat');
    expect(await contributionIds()).toEqual(['2026-08-01']);
  });

  it('refuses members without a join date', async () => {
    await seedMember();
    await db().doc(`members/${MEMBER}`).update({ datejoined: admin.firestore.FieldValue.delete() });
    await expect(createContributions(['2026-08-01'])).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('keeps administrator-reserved credit out of the batch', async () => {
    await seedMember({ balance: 600, reservedKcbCredit: 400 });
    await createContributions(['2026-06-01', '2026-07-01']);
    expect(await contributionDoc('2026-06-01')).toMatchObject({ balance: 300, paid: 'partial' });
    expect(await contributionDoc('2026-07-01')).toMatchObject({ balance: 500, paid: 'unpaid' });
    expect(await memberDoc()).toMatchObject({
      balance: -400,
      reservedKcbCredit: 400,
      contributionBalance: 200,
    });
  });

  it('is limited to administrators and active members', async () => {
    await seedMember();
    await expect(createContributions(['2026-06-01'], memberAuth)).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await db().doc(`members/${MEMBER}`).update({ status: 'suspended' });
    await expect(createContributions(['2026-06-01'])).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(await contributionIds()).toEqual([]);
  });
});
