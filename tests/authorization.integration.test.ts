import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { statementPdf } from './fixtures/kcbStatementPdf';

// Runs against the Firestore emulator only (see `npm run test:integration`).
process.env.GCLOUD_PROJECT = 'demo-tmbwa';
process.env.KCB_STK_CALLBACK_URL = 'https://example.test/kcbStkCallback';
process.env.KCB_STK_CALLBACK_TOKEN = 'callback-token';
process.env.KCB_CONSUMER_KEY = 'consumer-key';
process.env.KCB_CONSUMER_SECRET = 'consumer-secret';
process.env.KCB_TOKEN_URL = 'https://kcb.example.test/token';
process.env.KCB_STK_URL = 'https://kcb.example.test/stkpush';
process.env.KCB_STK_ROUTE_CODE = '207';
process.env.KCB_SHARED_REFERENCE = '7969138';
process.env.KCB_CURRENCY = 'KES';
process.env.KCB_STATEMENT_ACCOUNT_NUMBER = '1100000001';

const { admin } = await import('../functions/src/firebaseAdmin');
admin.initializeApp({ projectId: 'demo-tmbwa', storageBucket: 'demo-tmbwa.appspot.com' });
const financial = await import('../functions/src/financial');
const kcb = await import('../functions/src/kcb');
const kcbStatement = await import('../functions/src/kcb/statement');
const beneficiaries = await import('../functions/src/beneficiaries');
const notifications = await import('../functions/src/notifications');

const db = () => admin.firestore();
const ACTOR = 'officer-1';
const TARGET = 'member-target';

type Callable = { run: (request: never) => Promise<unknown> };
const call = (fn: unknown, auth: unknown, data: Record<string, unknown>) =>
  (fn as Callable).run({ auth, data, rawRequest: {} } as never);

// Resolves to the HttpsError code, or 'ok' when the command succeeds.
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: { code?: string }) => error.code ?? 'error',
  );

const withRoles = (roles: string[], uid = ACTOR) => ({ uid, token: { roles } });

// The record grants every role, so each test's token claims decide access.
const allRoles = ['member', 'super_admin', 'treasurer', 'registrar', 'welfare_officer', 'auditor'];
const seedActor = (status = 'active', uid = ACTOR, roles = allRoles) =>
  db().doc(`members/${uid}`).set({ status, roles });

const seedTarget = () =>
  db().doc(`members/${TARGET}`).set({
    firstname: 'Synthetic',
    lastname: 'Member',
    membernumber: '0001/26',
    win: 'WIN-1',
    phonenumber: '0712345678',
    gender: 'female',
    email: 'synthetic@example.test',
    role: 'member',
    isFeesPaid: true,
    status: 'active',
    balance: 0,
    contributionBalance: 0,
    reservedKcbCredit: 0,
    datejoined: admin.firestore.Timestamp.fromDate(new Date('2026-01-10T09:00:00+03:00')),
  });

const clearFirestore = () =>
  fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-tmbwa/databases/(default)/documents`,
    { method: 'DELETE' },
  );

type Case = {
  name: string;
  fn: unknown;
  allowed: string;
  denied: string;
  // Valid enough to pass authorization; the command may still fail later.
  data: (memberId: string) => Record<string, unknown>;
};

const requestId = 'authz-request-0001';

const cases: Case[] = [
  {
    name: 'recordContributionPayment',
    fn: financial.recordContributionPayment,
    allowed: 'treasurer',
    denied: 'auditor',
    data: () => ({ requestId }),
  },
  {
    name: 'reverseContributionPayment',
    fn: financial.reverseContributionPayment,
    allowed: 'treasurer',
    denied: 'auditor',
    data: (memberId) => ({ requestId, memberId, paymentId: 'payment-1' }),
  },
  {
    name: 'createContribution',
    fn: financial.createContribution,
    allowed: 'treasurer',
    denied: 'registrar',
    data: (memberId) => ({ requestId, memberId, month: '2026-09-01' }),
  },
  {
    name: 'createContributions',
    fn: financial.createContributions,
    allowed: 'treasurer',
    denied: 'welfare_officer',
    data: (memberId) => ({ requestId, memberId, months: ['2026-09-01'] }),
  },
  {
    name: 'adjustMemberBalance',
    fn: financial.adjustMemberBalance,
    allowed: 'treasurer',
    denied: 'auditor',
    data: () => ({ requestId }),
  },
  {
    name: 'correctLegacyContribution',
    fn: financial.correctLegacyContribution,
    allowed: 'treasurer',
    denied: 'auditor',
    data: (memberId) => ({
      requestId,
      memberId,
      contributionId: '2026-09-01',
      correctedPaidAmount: 500,
      reason: 'Correction',
    }),
  },
  {
    name: 'reverseLegacyContributionCorrection',
    fn: financial.reverseLegacyContributionCorrection,
    allowed: 'treasurer',
    denied: 'auditor',
    data: (memberId) => ({ requestId, memberId, correctionId: 'correction-1', reason: 'Reversal' }),
  },
  {
    name: 'listLegacyContributionInventory',
    fn: financial.listLegacyContributionInventory,
    allowed: 'treasurer',
    denied: 'auditor',
    data: () => ({}),
  },
  {
    name: 'removeContribution',
    fn: financial.removeContribution,
    allowed: 'treasurer',
    denied: 'registrar',
    data: (memberId) => ({ requestId, memberId, contributionId: '2026-09-01', reason: 'Duplicate' }),
  },
  {
    name: 'deleteMemberSafely',
    fn: financial.deleteMemberSafely,
    allowed: 'super_admin',
    denied: 'registrar',
    data: (memberId) => ({ requestId, memberId }),
  },
  {
    name: 'transitionMemberStatus',
    fn: financial.transitionMemberStatus,
    allowed: 'registrar',
    denied: 'treasurer',
    data: (memberId) => ({ requestId, memberId, status: 'suspended' }),
  },
  {
    name: 'reconcileKcbPayment',
    fn: kcb.reconcileKcbPayment,
    allowed: 'treasurer',
    denied: 'welfare_officer',
    data: (memberId) => ({ requestId, providerTransactionId: 'R-404', memberId, allocations: [] }),
  },
  {
    name: 'allocateKcbPaymentCredit',
    fn: kcb.allocateKcbPaymentCredit,
    allowed: 'treasurer',
    denied: 'auditor',
    data: () => ({
      requestId,
      providerTransactionId: 'R-404',
      allocations: [{ contributionId: '2026-09-01', amount: 500 }],
    }),
  },
  {
    name: 'previewKcbStatement',
    fn: kcbStatement.previewKcbStatement,
    allowed: 'treasurer',
    denied: 'auditor',
    data: () => ({ pdfBase64: 'bm90IGEgcGRm' }),
  },
  {
    name: 'importKcbStatement',
    fn: kcbStatement.importKcbStatement,
    allowed: 'treasurer',
    denied: 'auditor',
    // A valid statement and selection, so the command reaches its transactions.
    data: () => ({
      requestId,
      receipts: ['TD11AAAAAA'],
      pdfBase64: statementPdf({
        account: '1100000001', period: '01.04.2025 - 01.05.2025',
        start: '0.00', end: '500.00', moneyIn: '500.00', moneyOut: '0.00',
      }, [
        { date: '01.04.2025', details: ['BALANCE B/FWD'], out: '0.00', in: '0.00', balance: '0.00' },
        {
          date: '02.04.2025', details: ['Transfer 7969138 MPESA', 'TD11AAAAAA 254700000001 JANE /'],
          out: '0.00', in: '500.00', balance: '500.00', reference: 'FT25092AAAA1',
        },
      ]).toString('base64'),
    }),
  },
  {
    name: 'markKcbPaymentAlreadyRecorded',
    fn: kcbStatement.markKcbPaymentAlreadyRecorded,
    allowed: 'treasurer',
    denied: 'auditor',
    data: (memberId) => ({
      requestId, providerTransactionId: 'R-404', memberId, paymentIds: ['payment-404'], reason: 'Recorded by hand',
    }),
  },
  {
    name: 'undoKcbPaymentAlreadyRecorded',
    fn: kcbStatement.undoKcbPaymentAlreadyRecorded,
    allowed: 'treasurer',
    denied: 'registrar',
    data: () => ({ requestId, providerTransactionId: 'R-404', reason: 'Linked in error' }),
  },
  {
    name: 'rejectKcbPayment',
    fn: kcb.rejectKcbPayment,
    allowed: 'treasurer',
    denied: 'registrar',
    data: () => ({ requestId, providerTransactionId: 'R-404', reason: 'Unknown payer' }),
  },
  {
    name: 'resolveKcbStkUnknownOutcome',
    fn: kcb.resolveKcbStkUnknownOutcome,
    allowed: 'treasurer',
    denied: 'auditor',
    data: () => ({ requestId, stkRequestId: 'stk-404', reason: 'Confirmed with KCB' }),
  },
  {
    name: 'setInitialBeneficiaries',
    fn: beneficiaries.setInitialBeneficiaries,
    allowed: 'welfare_officer',
    denied: 'treasurer',
    data: (memberId) => ({
      requestId,
      memberId,
      beneficiaries: [
        {
          firstname: 'Baraka',
          lastname: 'Synthetic',
          relationship: 'son',
          dateOfBirth: '2015-04-20',
          idnumber: '',
        },
      ],
    }),
  },
  {
    name: 'approveBeneficiaryChange',
    fn: beneficiaries.approveBeneficiaryChange,
    allowed: 'welfare_officer',
    denied: 'auditor',
    data: () => ({ requestId }),
  },
  {
    name: 'rejectBeneficiaryChange',
    fn: beneficiaries.rejectBeneficiaryChange,
    allowed: 'welfare_officer',
    denied: 'registrar',
    data: () => ({ requestId, reviewNote: 'Incomplete' }),
  },
  {
    name: 'retryNotificationDelivery',
    fn: notifications.retryNotificationDelivery,
    allowed: 'super_admin',
    denied: 'treasurer',
    data: () => ({ deliveryId: 'delivery-404' }),
  },
];

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Run with the Firestore emulator: npm run test:integration');
  }
});

beforeEach(async () => {
  await clearFirestore();
  await seedActor();
});

afterAll(async () => {
  await clearFirestore();
});

const authorizationFailures = ['unauthenticated', 'permission-denied'];

describe.each(cases)('$name authorization', ({ fn, allowed, denied, data }) => {
  it('requires sign in', async () => {
    expect(await outcome(call(fn, undefined, data(TARGET)))).toBe('unauthenticated');
  });

  it(`denies ${denied}`, async () => {
    expect(await outcome(call(fn, withRoles([denied]), data(TARGET)))).toBe('permission-denied');
  });

  it('denies a plain member', async () => {
    expect(await outcome(call(fn, { uid: ACTOR, token: { role: 'member' } }, data(TARGET)))).toBe(
      'permission-denied',
    );
  });

  it(`allows ${allowed}`, async () => {
    expect(authorizationFailures).not.toContain(
      await outcome(call(fn, withRoles([allowed]), data(TARGET))),
    );
  });

  it('allows a super admin', async () => {
    expect(authorizationFailures).not.toContain(
      await outcome(call(fn, withRoles(['super_admin']), data(TARGET))),
    );
  });

  it('denies the retired administrator claim', async () => {
    expect(await outcome(call(fn, { uid: ACTOR, token: { role: 'administrator' } }, data(TARGET)))).toBe(
      'permission-denied',
    );
  });

  it.each(['suspended', 'inactive'])('denies a %s officer', async (status) => {
    await seedActor(status);
    await expect(call(fn, withRoles([allowed]), data(TARGET))).rejects.toMatchObject({
      code: 'permission-denied',
      message: 'Your account is not active.',
    });
  });

  it('denies an officer without a member record', async () => {
    await db().doc(`members/${ACTOR}`).delete();
    expect(await outcome(call(fn, withRoles([allowed]), data(TARGET)))).toBe('permission-denied');
  });
});

describe('roles held by the member record', () => {
  it('denies a role the token claims but the record no longer grants', async () => {
    await seedActor('active', ACTOR, ['member', 'auditor']);
    await expect(
      call(financial.listLegacyContributionInventory, withRoles(['treasurer']), {}),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('grants nothing for a record that only carries the retired administrator role', async () => {
    await db().doc(`members/${ACTOR}`).set({ status: 'active', role: 'administrator' });
    await expect(
      call(financial.listLegacyContributionInventory, withRoles(['super_admin']), {}),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('accepts a super admin whose record holds the role', async () => {
    await seedActor('active', ACTOR, ['member', 'super_admin']);
    await expect(
      call(financial.listLegacyContributionInventory, withRoles(['super_admin']), {}),
    ).resolves.toMatchObject({ scanned: 0 });
  });
});

describe('actions on the actor\'s own record', () => {
  const ownAccount = {
    code: 'permission-denied',
    message: 'You cannot perform this action on your own account. Another officer must do it.',
  };
  const selfTargeted = cases.filter(({ name }) =>
    [
      'reverseContributionPayment',
      'createContribution',
      'createContributions',
      'correctLegacyContribution',
      'reverseLegacyContributionCorrection',
      'removeContribution',
      'deleteMemberSafely',
      'transitionMemberStatus',
      'reconcileKcbPayment',
      'markKcbPaymentAlreadyRecorded',
    ].includes(name),
  );

  it.each(selfTargeted)('$name rejects a super admin acting on themselves', async ({ fn, data }) => {
    await expect(call(fn, withRoles(['super_admin']), data(ACTOR))).rejects.toMatchObject(ownAccount);
  });

  const notification = {
    payerPhone: '+254712345678',
    payerName: 'Synthetic Payer',
    amount: 500,
    currency: 'KES',
    billReference: '7969138',
    transactionDate: '20260915090000',
    matchReason: 'manual',
  };
  const stkRequest = {
    requestId: 'stk-own',
    memberId: ACTOR,
    contributionId: '2026-09-01',
    amount: 500,
    phone: '+254712345678',
    invoiceNumber: 'INV-1',
    messageId: 'message-1',
    status: 'outcome_unknown',
  };

  it('allocateKcbPaymentCredit rejects credit on the actor\'s own payment', async () => {
    await db().doc('kcb_payment_notifications/R-OWN').set({
      ...notification,
      status: 'reconciled',
      memberId: ACTOR,
      paymentId: 'payment-own',
    });
    await expect(
      call(kcb.allocateKcbPaymentCredit, withRoles(['treasurer']), {
        requestId,
        providerTransactionId: 'R-OWN',
        allocations: [{ contributionId: '2026-09-01', amount: 500 }],
      }),
    ).rejects.toMatchObject(ownAccount);
  });

  it('rejectKcbPayment rejects the actor\'s own payment', async () => {
    await db().doc('kcb_payment_notifications/R-OWN').set({
      ...notification,
      status: 'unresolved',
      memberId: ACTOR,
    });
    await expect(
      call(kcb.rejectKcbPayment, withRoles(['treasurer']), {
        requestId,
        providerTransactionId: 'R-OWN',
        reason: 'Unknown payer',
      }),
    ).rejects.toMatchObject(ownAccount);
    expect((await db().doc('kcb_payment_notifications/R-OWN').get()).get('status')).toBe('unresolved');
  });

  it('rejectKcbPayment rejects a payment linked to the actor\'s STK request', async () => {
    await db().doc('kcb_stk_requests/stk-own').set(stkRequest);
    await db().doc('kcb_payment_notifications/R-STK').set({
      ...notification,
      status: 'unresolved',
      source: 'stk_callback',
      stkRequestId: 'stk-own',
    });
    await expect(
      call(kcb.rejectKcbPayment, withRoles(['treasurer']), {
        requestId,
        providerTransactionId: 'R-STK',
        reason: 'Unknown payer',
      }),
    ).rejects.toMatchObject(ownAccount);
  });

  it('resolveKcbStkUnknownOutcome rejects the actor\'s own STK request', async () => {
    await db().doc('kcb_stk_requests/stk-own').set(stkRequest);
    await expect(
      call(kcb.resolveKcbStkUnknownOutcome, withRoles(['treasurer']), {
        requestId,
        stkRequestId: 'stk-own',
        reason: 'Confirmed with KCB',
      }),
    ).rejects.toMatchObject(ownAccount);
  });

  it('records no command or audit event for a refused self action', async () => {
    await outcome(
      call(financial.transitionMemberStatus, withRoles(['super_admin']), {
        requestId,
        memberId: ACTOR,
        status: 'suspended',
      }),
    );
    expect((await db().doc(`financial_commands/${requestId}`).get()).exists).toBe(false);
    expect((await db().doc(`audit_events/${requestId}`).get()).exists).toBe(false);
    expect((await db().doc(`members/${ACTOR}`).get()).get('status')).toBe('active');
  });
});

describe('requestKcbStkPush on behalf of another member', () => {
  const data = { requestId, memberId: TARGET, contributionId: '2026-09-01', amount: 500 };

  it('denies officers without kcb.reconcile', async () => {
    await expect(call(kcb.requestKcbStkPush, withRoles(['welfare_officer']), data)).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('denies an inactive treasurer', async () => {
    await seedActor('suspended');
    await expect(call(kcb.requestKcbStkPush, withRoles(['treasurer']), data)).rejects.toMatchObject({
      code: 'permission-denied',
      message: 'Your account is not active.',
    });
  });
});

describe('audit events record the actor\'s roles', () => {
  it('stores the roles held when the action was performed', async () => {
    await seedTarget();
    await call(financial.createContribution, withRoles(['treasurer', 'auditor']), {
      requestId,
      memberId: TARGET,
      month: '2026-09-01',
    });
    const event = (await db().doc(`audit_events/${requestId}`).get()).data();
    expect(event).toMatchObject({
      actorId: ACTOR,
      actorRoles: ['treasurer', 'auditor'],
      action: 'contribution.created',
    });
  });
});

describe('changes between authorization and commit', () => {
  // Changes the actor's member record after requirePermission has passed but
  // before the command's transaction runs, as a concurrent change would.
  const changeActorBeforeTransaction = (fields: Record<string, unknown>) => {
    const firestore = db();
    const runTransaction = firestore.runTransaction.bind(firestore);
    vi.spyOn(firestore, 'runTransaction').mockImplementation((async (
      ...args: Parameters<typeof runTransaction>
    ) => {
      await firestore.doc(`members/${ACTOR}`).update(fields);
      return runTransaction(...args);
    }) as typeof runTransaction);
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const suspended = { status: 'suspended' };
  // The officer stays active but loses every officer role.
  const revoked = { roles: ['member'] };
  const notActive = { code: 'permission-denied', message: 'Your account is not active.' };
  const noPermission = {
    code: 'permission-denied',
    message: 'You do not have permission to perform this action.',
  };
  const readOnlyOrRetired = [
    'recordContributionPayment',
    'adjustMemberBalance',
    'listLegacyContributionInventory',
    'previewKcbStatement',
  ];
  const mutations = cases.filter(({ name }) => !readOnlyOrRetired.includes(name));

  it.each(mutations)('$name re-checks the actor\'s status inside its transaction', async ({ fn, allowed, data }) => {
    changeActorBeforeTransaction(suspended);
    await expect(call(fn, withRoles([allowed]), data(TARGET))).rejects.toMatchObject(notActive);
  });

  it.each(mutations)('$name re-checks the actor\'s roles inside its transaction', async ({ fn, allowed, data }) => {
    changeActorBeforeTransaction(revoked);
    await expect(call(fn, withRoles([allowed]), data(TARGET))).rejects.toMatchObject(noPermission);
  });

  it('refuses a financial mutation once the treasurer role is revoked, writing nothing', async () => {
    await seedTarget();
    changeActorBeforeTransaction(revoked);
    await expect(
      call(financial.createContribution, withRoles(['treasurer']), {
        requestId,
        memberId: TARGET,
        month: '2026-09-01',
      }),
    ).rejects.toMatchObject(noPermission);
    expect((await db().doc(`members/${TARGET}/contributions/2026-09-01`).get()).exists).toBe(false);
    expect((await db().doc(`audit_events/${requestId}`).get()).exists).toBe(false);
  });

  it('refuses a mutation that would otherwise commit, writing nothing', async () => {
    await seedTarget();
    changeActorBeforeTransaction(suspended);
    await expect(
      call(financial.createContribution, withRoles(['treasurer']), {
        requestId,
        memberId: TARGET,
        month: '2026-09-01',
      }),
    ).rejects.toMatchObject(notActive);
    expect((await db().doc(`members/${TARGET}/contributions/2026-09-01`).get()).exists).toBe(false);
    expect((await db().doc(`financial_commands/${requestId}`).get()).exists).toBe(false);
    expect((await db().doc(`audit_events/${requestId}`).get()).exists).toBe(false);
    expect((await db().doc(`members/${TARGET}`).get()).get('balance')).toBe(0);
  });

  it('re-checks an officer prompting an STK payment for another member', async () => {
    changeActorBeforeTransaction(suspended);
    await expect(
      call(kcb.requestKcbStkPush, withRoles(['treasurer']), {
        requestId,
        memberId: TARGET,
        contributionId: '2026-09-01',
        amount: 500,
      }),
    ).rejects.toMatchObject(notActive);
    expect((await db().collection('kcb_stk_requests').get()).empty).toBe(true);
  });

  it('re-checks the role of an officer prompting an STK payment for another member', async () => {
    changeActorBeforeTransaction(revoked);
    await expect(
      call(kcb.requestKcbStkPush, withRoles(['treasurer']), {
        requestId,
        memberId: TARGET,
        contributionId: '2026-09-01',
        amount: 500,
      }),
    ).rejects.toMatchObject(noPermission);
    expect((await db().collection('kcb_stk_requests').get()).empty).toBe(true);
  });
});
