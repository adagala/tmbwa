import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Runs against the Firestore emulator only (see `npm run test:integration`).
process.env.GCLOUD_PROJECT = 'demo-tmbwa';
process.env.KCB_STK_CALLBACK_URL = 'https://example.test/kcbStkCallback';
process.env.KCB_STK_CALLBACK_TOKEN = 'callback-token';
process.env.KCB_CONSUMER_KEY = 'consumer-key';
process.env.KCB_CONSUMER_SECRET = 'consumer-secret';
// Params do not fall back to their declared defaults outside the Functions runtime.
process.env.KCB_TOKEN_URL = 'https://kcb.example.test/token';
process.env.KCB_STK_URL = 'https://kcb.example.test/stkpush';
process.env.KCB_STK_ROUTE_CODE = '207';
process.env.KCB_SHARED_REFERENCE = '7969138';
process.env.KCB_CURRENCY = 'KES';

const { admin } = await import('../functions/src/firebaseAdmin');
admin.initializeApp({ projectId: 'demo-tmbwa' });
const kcb = await import('../functions/src/kcb');
const financial = await import('../functions/src/financial');
const { generateMonthlyContributions } = await import(
  '../functions/src/contributions'
);

const db = () => admin.firestore();
const MEMBER = 'member-a';
const PHONE = '+254712345678';

const memberFields = {
  firstname: 'Alice',
  lastname: 'Member',
  membernumber: '1234/24',
  win: 'WIN-1',
  phonenumber: '0712345678',
  gender: 'female',
  email: 'alice@example.test',
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
      ...overrides,
    });

const seedContribution = (month: string, amount: number, balance: number) =>
  db()
    .doc(`members/${MEMBER}/contributions/${month}`)
    .set({
      ...memberFields,
      status: 'active',
      balance,
      contributionBalance: 0,
      member_id: MEMBER,
      contribution_id: month,
      month,
      amount,
      paid: balance === 0 ? 'paid' : balance < amount ? 'partial' : 'unpaid',
      payments: [],
    });

const memberDoc = async () => (await db().doc(`members/${MEMBER}`).get()).data()!;
const contributionDoc = async (month: string) =>
  (await db().doc(`members/${MEMBER}/contributions/${month}`).get()).data()!;
const payments = async () =>
  (await db().collection(`members/${MEMBER}/payments`).get()).docs.map((item) =>
    item.data(),
  );

const memberAuth = (uid = MEMBER) => ({ uid, token: { role: 'member' } });
const adminAuth = { uid: 'admin-1', token: { role: 'administrator' } };

let checkoutSequence = 0;

const mockKcbAccepts = (checkoutRequestId: string) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        String(url).includes('token')
          ? { access_token: 'token' }
          : {
              header: { statusCode: '0' },
              response: {
                ResponseCode: 0,
                MerchantRequestID: `merchant-${checkoutRequestId}`,
                CheckoutRequestID: checkoutRequestId,
              },
            },
    })),
  );
};

const callable = (
  fn: { run: (request: never) => unknown },
  auth: unknown,
  data: Record<string, unknown>,
) => fn.run({ auth, data, rawRequest: {} } as never) as Promise<Record<string, unknown>>;

const requestTopUp = async (
  amount: number,
  auth: unknown = memberAuth(),
  phone?: string,
) => {
  checkoutSequence += 1;
  const checkoutRequestId = `checkout-${checkoutSequence}`;
  mockKcbAccepts(checkoutRequestId);
  const requestId = `topup-${checkoutSequence}`;
  const result = await callable(kcb.requestKcbStkPush, auth, {
    requestId,
    memberId: MEMBER,
    purpose: 'account_top_up',
    amount,
    ...(phone === undefined ? {} : { phone }),
  });
  return { requestId, checkoutRequestId, result };
};

const deliverCallback = async (
  checkoutRequestId: string,
  amount: number,
  receiptNumber: string,
  resultCode = 0,
  payerPhone = PHONE,
) => {
  const response = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    send(body: unknown) {
      this.body = body;
      return this;
    },
    set() {
      return this;
    },
  };
  await (kcb.kcbStkCallback as unknown as (req: unknown, res: unknown) => Promise<void>)(
    {
      method: 'POST',
      query: { token: 'callback-token' },
      get: () => '',
      body: {
        Body: {
          stkCallback: {
            MerchantRequestID: `merchant-${checkoutRequestId}`,
            CheckoutRequestID: checkoutRequestId,
            ResultCode: resultCode,
            ResultDesc: resultCode === 0 ? 'Processed' : 'Cancelled',
            ...(resultCode === 0
              ? {
                  CallbackMetadata: {
                    Item: [
                      { Name: 'Amount', Value: amount },
                      { Name: 'MpesaReceiptNumber', Value: receiptNumber },
                      { Name: 'PhoneNumber', Value: payerPhone.slice(1) },
                      { Name: 'TransactionDate', Value: '20260930101010' },
                    ],
                  },
                }
              : {}),
          },
        },
      },
    },
    response,
  );
  return response;
};

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
  vi.unstubAllGlobals();
  await clearFirestore();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await clearFirestore();
});

describe('account top-ups', () => {
  it('holds a top-up as unreserved credit and applies it to the next contribution', async () => {
    await seedMember();
    const { requestId, checkoutRequestId } = await requestTopUp(1500);
    const callback = await deliverCallback(checkoutRequestId, 1500, 'R-1');
    expect(callback.statusCode).toBe(200);

    const member = await memberDoc();
    expect(member.balance).toBe(1500);
    expect(member.reservedKcbCredit).toBe(0);
    const [payment] = await payments();
    expect(payment).toMatchObject({
      amount: 1500,
      payment_type: 'account',
      payment_purpose: 'account_top_up',
      allocations: [],
      unallocated_amount: 1500,
      credit_reserved: false,
      provider_transaction_id: 'R-1',
      request_id: requestId,
    });
    const notification = (
      await db().doc('kcb_payment_notifications/R-1').get()
    ).data()!;
    expect(notification).toMatchObject({
      status: 'reconciled',
      purpose: 'account_top_up',
      creditReserved: false,
      unallocatedAmount: 1500,
    });
    expect((await db().doc(`kcb_stk_requests/${requestId}`).get()).data()!.status).toBe(
      'reconciled',
    );
    expect(
      (await db().doc(`members/${MEMBER}/payment_locks/stk_top_up`).get()).data()!.status,
    ).toBe('reconciled');

    await generateMonthlyContributions('2026-10');
    expect(await contributionDoc('2026-10')).toMatchObject({ balance: 0, paid: 'paid' });
    expect((await memberDoc()).balance).toBe(1000);
  });

  it('settles arrears oldest first and keeps the remainder as credit', async () => {
    await seedMember({ balance: -900 });
    await seedContribution('2026-04', 500, 500);
    await seedContribution('2026-03', 500, 400);
    const { checkoutRequestId } = await requestTopUp(1000);
    await deliverCallback(checkoutRequestId, 1000, 'R-2');

    expect(await contributionDoc('2026-03')).toMatchObject({ balance: 0, paid: 'paid' });
    expect(await contributionDoc('2026-04')).toMatchObject({ balance: 0, paid: 'paid' });
    const member = await memberDoc();
    expect(member.balance).toBe(100);
    expect(member.contributionBalance).toBe(900);
    const [payment] = await payments();
    expect(payment.allocations).toEqual([
      { contribution_id: '2026-03', amount: 400 },
      { contribution_id: '2026-04', amount: 500 },
    ]);
    expect(payment.unallocated_amount).toBe(100);
    expect((await db().doc('monthly_stats/2026-03').get()).data()!.contribution).toBe(400);
  });

  it('partially settles the oldest arrear when the top-up is smaller', async () => {
    await seedMember({ balance: -900 });
    await seedContribution('2026-03', 500, 400);
    await seedContribution('2026-04', 500, 500);
    const { checkoutRequestId } = await requestTopUp(300);
    await deliverCallback(checkoutRequestId, 300, 'R-3');

    expect(await contributionDoc('2026-03')).toMatchObject({ balance: 100, paid: 'partial' });
    expect(await contributionDoc('2026-04')).toMatchObject({ balance: 500, paid: 'unpaid' });
    expect((await memberDoc()).balance).toBe(-600);
  });

  it('leaves administrator-reserved credit for manual allocation', async () => {
    await seedMember({ balance: 200, reservedKcbCredit: 200 });
    const { checkoutRequestId } = await requestTopUp(300);
    await deliverCallback(checkoutRequestId, 300, 'R-4');
    expect(await memberDoc()).toMatchObject({ balance: 500, reservedKcbCredit: 200 });

    await generateMonthlyContributions('2026-10');
    expect(await contributionDoc('2026-10')).toMatchObject({ balance: 200, paid: 'partial' });
    expect(await memberDoc()).toMatchObject({ balance: 0, reservedKcbCredit: 200 });
  });

  it('applies a top-up whose callback arrived before the provider response', async () => {
    await seedMember({ balance: -500 });
    await seedContribution('2026-03', 500, 500);
    const checkoutRequestId = 'checkout-early';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('token')) {
          return { ok: true, json: async () => ({ access_token: 'token' }) };
        }
        // The callback was stored uncorrelated while the push request was in flight.
        await db().doc(`kcb_stk_unmatched_callbacks/${checkoutRequestId}`).set({
          merchantRequestId: `merchant-${checkoutRequestId}`,
          checkoutRequestId,
          receiptNumber: 'R-EARLY',
          amount: 800,
          payerPhone: PHONE,
          transactionDate: '20260930101010',
          resultCode: 0,
          resultDescription: 'Processed',
          status: 'pending_correlation',
        });
        return {
          ok: true,
          json: async () => ({
            header: { statusCode: '0' },
            response: {
              ResponseCode: 0,
              MerchantRequestID: `merchant-${checkoutRequestId}`,
              CheckoutRequestID: checkoutRequestId,
            },
          }),
        };
      }),
    );
    const result = await callable(kcb.requestKcbStkPush, memberAuth(), {
      requestId: 'topup-early',
      memberId: MEMBER,
      purpose: 'account_top_up',
      amount: 800,
    });
    expect(result.status).toBe('reconciled');
    expect(await contributionDoc('2026-03')).toMatchObject({ balance: 0, paid: 'paid' });
    expect(await memberDoc()).toMatchObject({ balance: 300, reservedKcbCredit: 0 });
    const [payment] = await payments();
    expect(payment).toMatchObject({ unallocated_amount: 300, credit_reserved: false });
    expect(
      (await db().doc(`kcb_stk_unmatched_callbacks/${checkoutRequestId}`).get()).data()!.status,
    ).toBe('correlated');
  });

  it('prompts the chosen number and credits the member whichever phone pays', async () => {
    await seedMember();
    const { requestId, checkoutRequestId } = await requestTopUp(
      600,
      memberAuth(),
      '0722 000 111',
    );
    const stkCall = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).includes('stkpush'))!;
    expect(JSON.parse(String(stkCall[1]!.body)).phoneNumber).toBe('254722000111');
    expect((await db().doc(`kcb_stk_requests/${requestId}`).get()).data()!.phone).toBe(
      '+254722000111',
    );

    const callback = await deliverCallback(
      checkoutRequestId,
      600,
      'R-OTHER',
      0,
      '+254733000222',
    );
    expect(callback.statusCode).toBe(200);
    expect((await memberDoc()).balance).toBe(600);
    const [payment] = await payments();
    expect(payment).toMatchObject({
      amount: 600,
      payer_phone: '+254733000222',
      request_id: requestId,
    });
    expect((await db().doc(`kcb_stk_requests/${requestId}`).get()).data()!.status).toBe(
      'reconciled',
    );
  });

  it('rejects an invalid prompt number without creating a request', async () => {
    await seedMember();
    await expect(requestTopUp(500, memberAuth(), '12345')).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect((await db().collection('kcb_stk_requests').get()).empty).toBe(true);
  });

  it('ignores a duplicate callback', async () => {
    await seedMember();
    const { checkoutRequestId } = await requestTopUp(700);
    await deliverCallback(checkoutRequestId, 700, 'R-5');
    await deliverCallback(checkoutRequestId, 700, 'R-5');
    expect(await payments()).toHaveLength(1);
    expect((await memberDoc()).balance).toBe(700);
  });

  it('records nothing when the member cancels the prompt', async () => {
    await seedMember();
    const { requestId, checkoutRequestId } = await requestTopUp(700);
    await deliverCallback(checkoutRequestId, 700, 'R-6', 1032);
    expect(await payments()).toHaveLength(0);
    expect((await memberDoc()).balance).toBe(0);
    expect((await db().doc(`kcb_stk_requests/${requestId}`).get()).data()!.status).toBe(
      'cancelled',
    );
    // The member can try again once the prompt has ended.
    await expect(requestTopUp(700)).resolves.toBeDefined();
  });

  it('rejects inactive members, other members, and invalid amounts', async () => {
    await seedMember({ status: 'inactive', balance: 250 });
    await expect(requestTopUp(500)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await memberDoc()).balance).toBe(250);

    await seedMember();
    await expect(requestTopUp(500, memberAuth('member-b'))).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await expect(requestTopUp(10.5)).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(requestTopUp(500, adminAuth)).resolves.toBeDefined();
  });

  it('allows only one top-up or contribution prompt at a time', async () => {
    await seedMember({ balance: -500 });
    await seedContribution('2026-03', 500, 500);
    const first = await requestTopUp(500);
    await expect(requestTopUp(500)).rejects.toMatchObject({ code: 'already-exists' });

    mockKcbAccepts('checkout-contribution');
    await expect(
      callable(kcb.requestKcbStkPush, memberAuth(), {
        requestId: 'contribution-1',
        memberId: MEMBER,
        contributionId: '2026-03',
        amount: 500,
      }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    await deliverCallback(first.checkoutRequestId, 500, 'R-7');
    await seedContribution('2026-04', 500, 500);
    mockKcbAccepts('checkout-contribution');
    await callable(kcb.requestKcbStkPush, memberAuth(), {
      requestId: 'contribution-1',
      memberId: MEMBER,
      contributionId: '2026-04',
      amount: 500,
    });
    await expect(requestTopUp(500)).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('lets an administrator reconcile a top-up whose till notification arrived first', async () => {
    await seedMember({ balance: -500 });
    await seedContribution('2026-03', 500, 500);
    const { requestId, checkoutRequestId } = await requestTopUp(800);
    await db().doc('kcb_payment_notifications/R-8').set({
      payerPhone: PHONE,
      payerName: 'Alice',
      amount: 800,
      currency: 'KES',
      billReference: '7969138',
      transactionDate: '20260930101010',
      status: 'unresolved',
      matchReason: 'unique_verified_phone',
      messageId: 'till-message',
    });
    await deliverCallback(checkoutRequestId, 800, 'R-8');
    expect((await db().doc(`kcb_stk_requests/${requestId}`).get()).data()!.status).toBe(
      'succeeded_pending_reconciliation',
    );
    expect(await payments()).toHaveLength(0);

    await expect(
      callable(kcb.reconcileKcbPayment, adminAuth, {
        requestId: 'reconcile-bad',
        providerTransactionId: 'R-8',
        memberId: MEMBER,
        allocations: [{ contributionId: '2026-03', amount: 500 }],
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    await callable(kcb.reconcileKcbPayment, adminAuth, {
      requestId: 'reconcile-1',
      providerTransactionId: 'R-8',
      memberId: MEMBER,
      allocations: [],
    });
    const duplicate = await callable(kcb.reconcileKcbPayment, adminAuth, {
      requestId: 'reconcile-1',
      providerTransactionId: 'R-8',
      memberId: MEMBER,
      allocations: [],
    });
    expect(duplicate.duplicate).toBe(true);

    expect(await contributionDoc('2026-03')).toMatchObject({ balance: 0, paid: 'paid' });
    expect(await memberDoc()).toMatchObject({ balance: 300, reservedKcbCredit: 0 });
    expect(await payments()).toHaveLength(1);
    expect((await db().doc(`kcb_stk_requests/${requestId}`).get()).data()!.status).toBe(
      'reconciled',
    );

    await expect(
      callable(kcb.allocateKcbPaymentCredit, adminAuth, {
        requestId: 'allocate-1',
        providerTransactionId: 'R-8',
        allocations: [{ contributionId: '2026-03', amount: 100 }],
      }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('reverses an unspent top-up and refuses once its credit has been used', async () => {
    await seedMember({ balance: -400 });
    await seedContribution('2026-03', 500, 400);
    const { checkoutRequestId } = await requestTopUp(600);
    await deliverCallback(checkoutRequestId, 600, 'R-9');
    const [payment] = await payments();

    await callable(financial.reverseContributionPayment, adminAuth, {
      requestId: 'reverse-1',
      memberId: MEMBER,
      paymentId: payment.payment_id,
    });
    expect(await contributionDoc('2026-03')).toMatchObject({ balance: 400, paid: 'partial' });
    expect(await memberDoc()).toMatchObject({ balance: -400, contributionBalance: 0 });
    expect((await db().doc('kcb_payment_notifications/R-9').get()).data()!.status).toBe(
      'reversed',
    );

    const second = await requestTopUp(900);
    await deliverCallback(second.checkoutRequestId, 900, 'R-10');
    await generateMonthlyContributions('2026-10');
    const topUp = (await payments()).find((item) => item.provider_transaction_id === 'R-10')!;
    await expect(
      callable(financial.reverseContributionPayment, adminAuth, {
        requestId: 'reverse-2',
        memberId: MEMBER,
        paymentId: topUp.payment_id,
      }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('refuses to reverse a top-up whose credit was applied even after later credit arrives', async () => {
    await seedMember();
    const first = await requestTopUp(600);
    await deliverCallback(first.checkoutRequestId, 600, 'R-A');
    // Top-up A's remainder pays the next contribution as BALANCE B/F.
    await generateMonthlyContributions('2026-10');
    expect(await contributionDoc('2026-10')).toMatchObject({ balance: 0, paid: 'paid' });
    // Top-up B restores enough aggregate credit to mask A's spend.
    const second = await requestTopUp(500);
    await deliverCallback(second.checkoutRequestId, 500, 'R-B');
    expect((await memberDoc()).balance).toBe(600);

    const topUpA = (await payments()).find((item) => item.provider_transaction_id === 'R-A')!;
    await expect(
      callable(financial.reverseContributionPayment, adminAuth, {
        requestId: 'reverse-a',
        memberId: MEMBER,
        paymentId: topUpA.payment_id,
      }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await memberDoc()).balance).toBe(600);
    expect(await payments()).toHaveLength(3);
    expect((await db().doc('kcb_payment_notifications/R-A').get()).data()!.status).toBe(
      'reconciled',
    );
  });

  it('still reverses a top-up when credit was only applied before it', async () => {
    await seedMember({ balance: 500 });
    await generateMonthlyContributions('2026-09');
    expect((await memberDoc()).balance).toBe(0);
    const { checkoutRequestId } = await requestTopUp(400);
    await deliverCallback(checkoutRequestId, 400, 'R-C');
    const topUp = (await payments()).find((item) => item.provider_transaction_id === 'R-C')!;
    await callable(financial.reverseContributionPayment, adminAuth, {
      requestId: 'reverse-c',
      memberId: MEMBER,
      paymentId: topUp.payment_id,
    });
    expect((await memberDoc()).balance).toBe(0);
  });
});
