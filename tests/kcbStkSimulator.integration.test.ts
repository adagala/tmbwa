import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Runs against the Firestore emulator only (see `npm run test:integration`).
// Chains the development STK simulator to the production STK code:
// requestKcbStkPush -> kcbDevMockApi -> resolveKcbDevStkPrompt -> kcbStkCallback.
const ORIGIN = 'https://dev.example.test';
process.env.GCLOUD_PROJECT = 'demo-tmbwa';
process.env.APP_ENV = 'development';
process.env.KCB_DEV_MOCK_ENABLED = 'true';
process.env.KCB_DEV_ALLOWED_CALLBACK_ORIGIN = ORIGIN;
process.env.KCB_STK_CALLBACK_URL = `${ORIGIN}/kcbStkCallback`;
process.env.KCB_STK_CALLBACK_TOKEN = 'callback-token';
process.env.KCB_CONSUMER_KEY = 'consumer-key';
process.env.KCB_CONSUMER_SECRET = 'consumer-secret';
// The dev configuration points the production STK code at the mock API.
process.env.KCB_TOKEN_URL = `${ORIGIN}/kcbDevMockApi/token?grant_type=client_credentials`;
process.env.KCB_STK_URL = `${ORIGIN}/kcbDevMockApi/stkpush`;
process.env.KCB_STK_ROUTE_CODE = '207';
process.env.KCB_SHARED_REFERENCE = '7969138';
process.env.KCB_CURRENCY = 'KES';

const { admin } = await import('../functions/src/firebaseAdmin');
admin.initializeApp({ projectId: 'demo-tmbwa' });
const kcb = await import('../functions/src/kcb');
// The development-tools codebase initializes its own Admin SDK.
const devTools = await import('../functions-dev/src/index');

const db = () => admin.firestore();
const MEMBER = 'member-a';
const OTHER_MEMBER = 'member-b';

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
  (await db().collection(`members/${MEMBER}/payments`).get()).docs.map((item) => item.data());
const stkRequestStatus = async (requestId: string) =>
  (await db().doc(`kcb_stk_requests/${requestId}`).get()).data()!.status;

const memberAuth = (uid = MEMBER) => ({ uid, token: { role: 'member' } });

const callable = (
  fn: { run: (request: never) => unknown },
  auth: unknown,
  data: Record<string, unknown>,
) => fn.run({ auth, data, rawRequest: {} } as never) as Promise<Record<string, unknown>>;

type HttpHandler = (req: unknown, res: unknown) => Promise<void>;

// Invokes an onRequest handler in process and returns a fetch-like response.
const invokeHttp = async (
  handler: unknown,
  request: {
    path: string;
    query?: Record<string, string>;
    headers: Record<string, string>;
    body: unknown;
  },
) => {
  const response = {
    statusCode: 200,
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
  const headers = Object.fromEntries(
    Object.entries(request.headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  await (handler as HttpHandler)(
    {
      method: 'POST',
      path: request.path,
      query: request.query ?? {},
      headers,
      get: (name: string) => headers[name.toLowerCase()],
      body: request.body,
    },
    response,
  );
  return {
    ok: response.statusCode >= 200 && response.statusCode < 300,
    status: response.statusCode,
    json: async () => response.body,
  };
};

let callbackPosts = 0;

// Routes outbound HTTPS to the in-process mock API and production callback,
// as the deployed functions would reach each other.
const routeFetch = () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: { headers?: Record<string, string>; body?: string } = {}) => {
      const url = new URL(String(input));
      const body = init.body ? JSON.parse(init.body) : undefined;
      const headers = init.headers ?? {};
      if (url.pathname.startsWith('/kcbDevMockApi/')) {
        return invokeHttp(devTools.kcbDevMockApi, {
          path: url.pathname.slice('/kcbDevMockApi'.length),
          headers,
          body,
        });
      }
      if (url.pathname === '/kcbStkCallback') {
        callbackPosts += 1;
        return invokeHttp(kcb.kcbStkCallback, {
          path: url.pathname,
          query: Object.fromEntries(url.searchParams),
          headers,
          body,
        });
      }
      throw new Error(`Unexpected outbound request to ${url.origin}${url.pathname}`);
    }),
  );
};

let sequence = 0;

const requestStk = async (data: Record<string, unknown>, auth: unknown = memberAuth()) => {
  sequence += 1;
  const requestId = `stk-${sequence}`;
  const result = await callable(kcb.requestKcbStkPush, auth, {
    requestId,
    memberId: MEMBER,
    phone: '0712345678',
    ...data,
  });
  return { requestId, result };
};

const promptFor = async (stkRequestId: string, auth: unknown = memberAuth()) => {
  const listed = await callable(devTools.listKcbDevStkPrompts, auth, { stkRequestId });
  const prompts = listed.prompts as Array<{ promptId: string; amount: number; status: string }>;
  expect(prompts).toHaveLength(1);
  return prompts[0];
};

const resolvePrompt = (promptId: string, outcome: string, auth: unknown = memberAuth()) =>
  callable(devTools.resolveKcbDevStkPrompt, auth, { promptId, outcome });

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
  callbackPosts = 0;
  routeFetch();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await clearFirestore();
});

describe('development KCB STK simulator', () => {
  it('records an approved top-up through the production callback', async () => {
    await seedMember({ balance: -400 });
    await seedContribution('2026-03', 500, 400);
    const { requestId, result } = await requestStk({ purpose: 'account_top_up', amount: 1000 });
    expect(result.status).toBe('pending');

    const prompt = await promptFor(requestId);
    expect(prompt).toMatchObject({ amount: 1000, status: 'pending' });
    expect(await resolvePrompt(prompt.promptId, 'approve')).toMatchObject({
      status: 'resolved',
      duplicate: false,
    });

    expect(await stkRequestStatus(requestId)).toBe('reconciled');
    expect(await contributionDoc('2026-03')).toMatchObject({ balance: 0, paid: 'paid' });
    expect(await memberDoc()).toMatchObject({ balance: 600, reservedKcbCredit: 0 });
    const [payment] = await payments();
    expect(payment).toMatchObject({
      amount: 1000,
      payment_purpose: 'account_top_up',
      unallocated_amount: 600,
      credit_reserved: false,
    });
    expect(payment.provider_transaction_id).toMatch(/^DEV/);
    // Resolved prompts are no longer listed.
    const listed = await callable(devTools.listKcbDevStkPrompts, memberAuth(), { stkRequestId: requestId });
    expect(listed.prompts).toEqual([]);
  });

  it('pays a contribution balance via STK', async () => {
    await seedMember({ balance: -500 });
    await seedContribution('2026-04', 500, 500);
    const { requestId } = await requestStk({ contributionId: '2026-04', amount: 500 });
    const prompt = await promptFor(requestId);
    await resolvePrompt(prompt.promptId, 'approve');

    expect(await stkRequestStatus(requestId)).toBe('reconciled');
    expect(await contributionDoc('2026-04')).toMatchObject({ balance: 0, paid: 'paid' });
    expect(await payments()).toHaveLength(1);
  });

  it('marks a cancelled prompt cancelled and records no payment', async () => {
    await seedMember();
    const { requestId } = await requestStk({ purpose: 'account_top_up', amount: 700 });
    const prompt = await promptFor(requestId);
    await resolvePrompt(prompt.promptId, 'cancel');

    expect(await stkRequestStatus(requestId)).toBe('cancelled');
    expect(await payments()).toEqual([]);
    expect((await memberDoc()).balance).toBe(0);
  });

  it('records only one payment when the same prompt is approved twice', async () => {
    await seedMember();
    const { requestId } = await requestStk({ purpose: 'account_top_up', amount: 800 });
    const prompt = await promptFor(requestId);
    await resolvePrompt(prompt.promptId, 'approve');
    expect(await resolvePrompt(prompt.promptId, 'approve')).toMatchObject({
      status: 'resolved',
      duplicate: true,
    });
    await expect(resolvePrompt(prompt.promptId, 'cancel')).rejects.toMatchObject({
      code: 'failed-precondition',
    });

    expect(callbackPosts).toBe(1);
    expect(await payments()).toHaveLength(1);
    expect((await memberDoc()).balance).toBe(800);
  });

  it('only lets the owning member or a super admin see and answer a prompt', async () => {
    await seedMember();
    const { requestId } = await requestStk({ purpose: 'account_top_up', amount: 300 });
    const prompt = await promptFor(requestId);

    const otherAuth = memberAuth(OTHER_MEMBER);
    const otherList = await callable(devTools.listKcbDevStkPrompts, otherAuth, {});
    expect(otherList.prompts).toEqual([]);
    await expect(resolvePrompt(prompt.promptId, 'approve', otherAuth)).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await expect(resolvePrompt(prompt.promptId, 'approve', null)).rejects.toMatchObject({
      code: 'unauthenticated',
    });

    const adminAuth = { uid: 'admin-1', token: { roles: ['super_admin'] } };
    await promptFor(requestId, adminAuth);
    await resolvePrompt(prompt.promptId, 'approve', adminAuth);
    expect(await payments()).toHaveLength(1);
  });

  it('refuses STK requests that do not carry the callback token', async () => {
    const response = await invokeHttp(devTools.kcbDevMockApi, {
      path: '/stkpush',
      headers: { Authorization: 'Bearer dev-abc123' },
      body: {
        phoneNumber: '254712345678',
        amount: '100',
        invoiceNumber: '7969138#TMBFORGED',
        callbackUrl: `${ORIGIN}/kcbStkCallback?token=wrong`,
      },
    });
    expect(response.status).toBe(403);
    expect((await db().collection('kcb_dev_stk_prompts').get()).empty).toBe(true);
  });

  it('refuses to run when the simulator is disabled', async () => {
    await seedMember();
    const { requestId } = await requestStk({ purpose: 'account_top_up', amount: 300 });
    const prompt = await promptFor(requestId);
    for (const [key, value] of [['APP_ENV', 'production'], ['KCB_DEV_MOCK_ENABLED', 'false']]) {
      const previous = process.env[key];
      process.env[key] = value;
      try {
        await expect(resolvePrompt(prompt.promptId, 'approve')).rejects.toMatchObject({
          code: 'failed-precondition',
        });
        await expect(callable(devTools.listKcbDevStkPrompts, memberAuth(), {})).rejects.toMatchObject({
          code: 'failed-precondition',
        });
        const mock = await invokeHttp(devTools.kcbDevMockApi, {
          path: '/token',
          headers: { Authorization: 'Basic abc' },
          body: undefined,
        });
        expect(mock.status).toBe(503);
      } finally {
        process.env[key] = previous;
      }
    }
    expect(callbackPosts).toBe(0);
    expect(await payments()).toEqual([]);
  });
});
