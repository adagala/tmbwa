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
// Synthetic Till notifications are unsigned, as in the KCB Sandbox.
process.env.APP_ENV = 'development';
process.env.KCB_DEV_MOCK_ENABLED = 'true';
process.env.KCB_PUBLIC_KEY = '';

const { admin } = await import('../functions/src/firebaseAdmin');
admin.initializeApp({ projectId: 'demo-tmbwa' });
const kcb = await import('../functions/src/kcb');
const { profilePhoneNormalized } = await import('../functions/src/members/phone');

const db = () => admin.firestore();
const MEMBER = 'member-a';
const PHONE = '+254712345678';
const MONTH = '2026-09';
const RECEIPT = 'TJ1A7XK2QF';
const FT_REFERENCE = 'FT26273K8QW2';
const TILL_DATE = 'Wed Sep 30 10:10:10 EAT 2026';
const STK_DATE = '20260930101010';

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

const seedMember = () =>
  db()
    .doc(`members/${MEMBER}`)
    .set({
      ...memberFields,
      status: 'active',
      balance: -1000,
      contributionBalance: 0,
      reservedKcbCredit: 0,
    });

const seedContribution = () =>
  db()
    .doc(`members/${MEMBER}/contributions/${MONTH}`)
    .set({
      ...memberFields,
      status: 'active',
      balance: 1000,
      contributionBalance: 0,
      member_id: MEMBER,
      contribution_id: MONTH,
      month: MONTH,
      amount: 1000,
      paid: 'unpaid',
      payments: [],
    });

const notification = async (id = RECEIPT) =>
  (await db().doc(`kcb_payment_notifications/${id}`).get()).data()!;
const notificationIds = async () =>
  (await db().collection('kcb_payment_notifications').get()).docs.map(
    (item) => item.id,
  );
const payments = async () =>
  (await db().collection(`members/${MEMBER}/payments`).get()).docs.map((item) =>
    item.data(),
  );
const stkRequest = async (requestId: string) =>
  (await db().doc(`kcb_stk_requests/${requestId}`).get()).data()!;

const memberAuth = () => ({ uid: MEMBER, token: { role: 'member' } });

const callable = (
  fn: { run: (request: never) => unknown },
  auth: unknown,
  data: Record<string, unknown>,
) => fn.run({ auth, data, rawRequest: {} } as never) as Promise<Record<string, unknown>>;

const providerAccepts = (checkoutRequestId: string) => ({
  ok: true,
  json: async () => ({
    header: { statusCode: '0' },
    response: {
      ResponseCode: 0,
      MerchantRequestID: `merchant-${checkoutRequestId}`,
      CheckoutRequestID: checkoutRequestId,
    },
  }),
});

const stubProvider = (checkoutRequestId: string, beforeResponse?: () => Promise<void>) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('token')) {
        return { ok: true, json: async () => ({ access_token: 'token' }) };
      }
      await beforeResponse?.();
      return providerAccepts(checkoutRequestId);
    }),
  );

const requestContributionPush = (requestId: string) =>
  callable(kcb.requestKcbStkPush, memberAuth(), {
    requestId,
    memberId: MEMBER,
    contributionId: MONTH,
    amount: 1000,
  });

const fakeResponse = () => ({
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
});

const invoke = async (handler: unknown, request: Record<string, unknown>) => {
  const response = fakeResponse();
  await (handler as (req: unknown, res: unknown) => Promise<void>)(request, response);
  return response;
};

const deliverStkCallback = (checkoutRequestId: string, amount: number) =>
  invoke(kcb.kcbStkCallback, {
    method: 'POST',
    query: { token: 'callback-token' },
    get: () => '',
    body: {
      Body: {
        stkCallback: {
          MerchantRequestID: `merchant-${checkoutRequestId}`,
          CheckoutRequestID: checkoutRequestId,
          ResultCode: 0,
          ResultDesc: 'Processed',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: amount },
              { Name: 'MpesaReceiptNumber', Value: RECEIPT },
              { Name: 'PhoneNumber', Value: Number(PHONE.slice(1)) },
              { Name: 'TransactionDate', Value: Number(STK_DATE) },
            ],
          },
        },
      },
    },
  });

const deliverTillNotification = (
  options: {
    amount?: number;
    messageId?: string;
    header?: Record<string, unknown>;
    data?: Record<string, unknown>;
  } = {},
) => {
  const body = {
    header: {
      messageID: options.messageId ?? 'kcb-message-1',
      originatorConversationID: RECEIPT,
      channelCode: '202',
      timeStamp: '20260930101012',
      ...options.header,
    },
    requestPayload: {
      primaryData: { businessKey: '7969138', businessKeyType: 'notifyBiller' },
      additionalData: {
        notificationData: {
          businessKey: '7969138',
          businessKeyType: 'BillReferenceNumber',
          debitMSISDN: PHONE.slice(1),
          transactionAmt: String(options.amount ?? 1000),
          transactionDate: TILL_DATE,
          transactionID: FT_REFERENCE,
          firstName: 'ALICE',
          middleName: '',
          lastName: 'MEMBER',
          currency: 'KES',
          narration: 'Contribution',
          transactionType: 'MPESA',
          balance: '0',
          ...options.data,
        },
      },
    },
  };
  return invoke(kcb.kcbTillNotification, {
    method: 'POST',
    get: () => '',
    rawBody: Buffer.from(JSON.stringify(body)),
    body,
  });
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
  await seedMember();
  await seedContribution();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await clearFirestore();
});

const tillReported = {
  messageId: 'kcb-message-1',
  channelCode: '202',
  transactionDate: TILL_DATE,
  transactionType: 'MPESA',
  billReference: '7969138',
  payerName: 'ALICE MEMBER',
  narration: 'Contribution',
  conversationId: RECEIPT,
  kcbMessageId: 'kcb-message-1',
  kcbChannelCode: '202',
  kcbTransactionReference: FT_REFERENCE,
};

describe('Till notifications and STK callbacks for one payment', () => {
  it('settles the STK payment automatically when the Till notification arrived first', async () => {
    stubProvider('checkout-1');
    await requestContributionPush('push-1');
    expect((await deliverTillNotification()).statusCode).toBe(200);
    expect(await notification()).toMatchObject({
      status: 'unresolved',
      source: 'till_notification',
      mpesaReceiptNumber: RECEIPT,
    });

    expect((await deliverStkCallback('checkout-1', 1000)).statusCode).toBe(200);

    const stored = await notification();
    expect(stored).toMatchObject({
      ...tillReported,
      providerTransactionId: RECEIPT,
      mpesaReceiptNumber: RECEIPT,
      status: 'reconciled',
      source: 'stk_callback',
      stkRequestId: 'push-1',
      memberId: MEMBER,
      contributionId: MONTH,
      checkoutRequestId: 'checkout-1',
      merchantRequestId: 'merchant-checkout-1',
      amount: 1000,
    });
    expect(stored.paidAt.toDate().toISOString()).toBe('2026-09-30T07:10:10.000Z');
    expect(await notificationIds()).toEqual([RECEIPT]);
    const [payment, ...others] = await payments();
    expect(others).toHaveLength(0);
    expect(payment).toMatchObject({ amount: 1000, provider_transaction_id: RECEIPT });
    expect((await stkRequest('push-1')).status).toBe('reconciled');
  });

  it('settles the payment when the Till notification arrived before a delayed callback', async () => {
    await deliverTillNotification();
    stubProvider('checkout-early', async () => {
      await db().doc('kcb_stk_unmatched_callbacks/checkout-early').set({
        merchantRequestId: 'merchant-checkout-early',
        checkoutRequestId: 'checkout-early',
        receiptNumber: RECEIPT,
        amount: 1000,
        payerPhone: PHONE,
        transactionDate: STK_DATE,
        resultCode: 0,
        resultDescription: 'Processed',
        status: 'pending_correlation',
      });
    });

    const result = await requestContributionPush('push-early');

    expect(result.status).toBe('reconciled');
    expect(await notification()).toMatchObject({
      ...tillReported,
      status: 'reconciled',
      source: 'stk_callback',
      stkRequestId: 'push-early',
      checkoutRequestId: 'checkout-early',
      merchantRequestId: 'merchant-checkout-early',
    });
    expect(await notificationIds()).toEqual([RECEIPT]);
    expect(await payments()).toHaveLength(1);
  });

  it('keeps the settled STK payment and adds the Till details when the Till notification follows', async () => {
    stubProvider('checkout-2');
    await requestContributionPush('push-2');
    await deliverStkCallback('checkout-2', 1000);
    const settled = await notification();
    expect(settled).toMatchObject({
      status: 'reconciled',
      messageId: 'checkout-2',
      payerName: '',
      mpesaReceiptNumber: RECEIPT,
    });

    expect((await deliverTillNotification()).statusCode).toBe(200);
    expect((await deliverTillNotification()).statusCode).toBe(200);

    const stored = await notification();
    expect(stored).toMatchObject({
      status: 'reconciled',
      source: 'stk_callback',
      paymentId: settled.paymentId,
      messageId: 'checkout-2',
      channelCode: 'stk',
      transactionDate: STK_DATE,
      transactionType: 'MPESA_STK',
      payerName: 'ALICE MEMBER',
      narration: 'Contribution',
      conversationId: RECEIPT,
      kcbMessageId: 'kcb-message-1',
      kcbChannelCode: '202',
      kcbTransactionReference: FT_REFERENCE,
      checkoutRequestId: 'checkout-2',
    });
    expect(stored.receivedAt).toEqual(settled.receivedAt);
    expect(stored.paidAt).toEqual(settled.paidAt);
    expect(await notificationIds()).toEqual([RECEIPT]);
    expect(await payments()).toHaveLength(1);
  });

  it('leaves a Till notification whose amount disagrees with the callback for an administrator', async () => {
    stubProvider('checkout-3');
    await requestContributionPush('push-3');
    await deliverTillNotification({ amount: 900 });

    await deliverStkCallback('checkout-3', 1000);

    expect(await notification()).toMatchObject({
      ...tillReported,
      status: 'unresolved',
      amount: 900,
      stkCallbackAmount: 1000,
      reconciliationWarning: 'payment_details_mismatch',
      stkRequestId: 'push-3',
      checkoutRequestId: 'checkout-3',
    });
    expect(await payments()).toHaveLength(0);
    expect((await stkRequest('push-3')).status).toBe('succeeded_pending_reconciliation');
  });

  it('stores a Till notification that omits optional fields or has an unknown date format', async () => {
    const response = await deliverTillNotification({
      header: { originatorConversationID: undefined },
      data: {
        narration: undefined,
        transactionType: undefined,
        transactionDate: '30/09/2026 10:10',
      },
    });

    expect(response.statusCode).toBe(200);
    const stored = await notification(FT_REFERENCE);
    expect(stored).toMatchObject({
      status: 'unresolved',
      providerTransactionId: FT_REFERENCE,
      kcbTransactionReference: FT_REFERENCE,
      transactionDate: '30/09/2026 10:10',
    });
    expect(stored).not.toHaveProperty('paidAt');
    expect(stored).not.toHaveProperty('mpesaReceiptNumber');
  });
});

describe('Till notification member suggestions', () => {
  // The member triggers keep phoneNormalized; they do not run here.
  const setProfilePhone = (memberId: string, phonenumber: string) =>
    db()
      .doc(`members/${memberId}`)
      .set(
        { phonenumber, phoneNormalized: profilePhoneNormalized(phonenumber) },
        { merge: true },
      );

  const deliverFrom = (debitMSISDN: string, receipt: string) =>
    deliverTillNotification({
      messageId: `message-${receipt}`,
      header: { originatorConversationID: receipt },
      data: { debitMSISDN, transactionID: `FT-${receipt}` },
    });

  it('suggests the one member whose profile phone matches the payer', async () => {
    await setProfilePhone(MEMBER, '0712345678');
    const response = await deliverTillNotification();

    expect(response.statusCode).toBe(200);
    expect(await notification()).toMatchObject({
      status: 'unresolved',
      payerPhone: PHONE,
      suggestedMemberId: MEMBER,
      matchReason: 'unique_profile_phone',
    });
    expect(await payments()).toHaveLength(0);
  });

  it('matches 07, 2547, +2547 and 01 forms of the same number', async () => {
    await setProfilePhone(MEMBER, '+254 712 345 678');
    await db().doc('members/member-b').set({
      ...memberFields,
      email: 'bob@example.test',
      status: 'active',
      balance: 0,
      contributionBalance: 0,
      reservedKcbCredit: 0,
    });
    await setProfilePhone('member-b', '0112 345-678');

    const deliveries: Array<[string, string, string]> = [
      ['0712345678', 'TJ1A7XK2Q1', MEMBER],
      ['254712345678', 'TJ1A7XK2Q2', MEMBER],
      ['+254712345678', 'TJ1A7XK2Q3', MEMBER],
      ['0112345678', 'TJ1A7XK2Q4', 'member-b'],
      ['254112345678', 'TJ1A7XK2Q5', 'member-b'],
    ];
    for (const [payer, receipt, memberId] of deliveries) {
      expect((await deliverFrom(payer, receipt)).statusCode).toBe(200);
      expect(await notification(receipt)).toMatchObject({
        suggestedMemberId: memberId,
        matchReason: 'unique_profile_phone',
      });
    }
  });

  it('suggests no member when several share the phone', async () => {
    await setProfilePhone(MEMBER, '0712345678');
    await db().doc('members/member-b').set({
      ...memberFields,
      email: 'bob@example.test',
      status: 'active',
      balance: 0,
      contributionBalance: 0,
      reservedKcbCredit: 0,
    });
    await setProfilePhone('member-b', '254712345678');
    await deliverTillNotification();

    expect(await notification()).toMatchObject({
      suggestedMemberId: null,
      matchReason: 'ambiguous_phone_match',
    });
  });

  it('suggests no member when no profile phone matches', async () => {
    await setProfilePhone(MEMBER, '0722000000');
    await deliverTillNotification();

    expect(await notification()).toMatchObject({
      suggestedMemberId: null,
      matchReason: 'no_verified_phone_match',
    });
  });
});
