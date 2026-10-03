import * as admin from 'firebase-admin';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import {
  assertDevSimulatorEnabled,
  buildSyntheticTillPayload,
  validateDevSimulatorConfig,
} from './devSimulator';
import {
  buildStkCallbackPayload,
  isStkPromptOutcome,
  mockStkPushResponse,
  mockTokenResponse,
  newSimulatedStkPrompt,
  parseMockStkPushRequest,
  stkPromptResolutionDecision,
  stkPushCallbackIsTrusted,
} from './stkSimulator';

admin.initializeApp();
const db = () => admin.firestore();

type Data = Record<string, unknown>;

const APP_ENV = defineString('APP_ENV', { default: 'production' });
const KCB_DEV_MOCK_ENABLED = defineString('KCB_DEV_MOCK_ENABLED', {
  default: 'false',
});
const KCB_TILL_CALLBACK_URL = defineString('KCB_TILL_CALLBACK_URL');
const KCB_DEV_ALLOWED_CALLBACK_ORIGIN = defineString(
  'KCB_DEV_ALLOWED_CALLBACK_ORIGIN',
);
const KCB_SHARED_REFERENCE = defineString('KCB_SHARED_REFERENCE', {
  default: '7969138',
});
const KCB_STK_CALLBACK_URL = defineString('KCB_STK_CALLBACK_URL');
const KCB_STK_CALLBACK_TOKEN = defineSecret('KCB_STK_CALLBACK_TOKEN');
// Server-only; firestore.rules denies all client access.
const STK_PROMPTS = 'kcb_dev_stk_prompts';

// Development tool only (see validateDevSimulatorConfig): limited to super
// admins by the `roles` claim. This codebase does not share tmbwa-shared.
const requireSuperAdmin = (
  auth: { uid: string; token: Record<string, unknown> } | undefined,
) => {
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in is required.');
  const roles = auth.token.roles;
  if (!Array.isArray(roles) || !roles.includes('super_admin')) {
    throw new HttpsError('permission-denied', 'Super admin access is required.');
  }
  return auth.uid;
};

const isSuperAdmin = (token: Record<string, unknown>) =>
  Array.isArray(token.roles) && token.roles.includes('super_admin');

const assertSimulatorEnabled = () => {
  try {
    assertDevSimulatorEnabled({
      appEnvironment: APP_ENV.value(),
      enabled: KCB_DEV_MOCK_ENABLED.value(),
    });
  } catch (error) {
    throw new HttpsError('failed-precondition', (error as Error).message);
  }
};

const stkCallbackUrl = () => {
  try {
    return validateDevSimulatorConfig({
      appEnvironment: APP_ENV.value(),
      enabled: KCB_DEV_MOCK_ENABLED.value(),
      callbackUrl: KCB_STK_CALLBACK_URL.value(),
      allowedOrigin: KCB_DEV_ALLOWED_CALLBACK_ORIGIN.value(),
      callbackFunction: 'kcbStkCallback',
    });
  } catch (error) {
    throw new HttpsError('failed-precondition', (error as Error).message);
  }
};

const requiredString = (data: Data, key: string) => {
  const value = data[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpsError('invalid-argument', `${key} is required.`);
  }
  return value.trim();
};

export const sendKcbDevTillNotification = onCall(
  async (request) => {
    const actorId = requireSuperAdmin(request.auth);
    const data = request.data as Data;
    const requestId = requiredString(data, 'requestId');
    const amount = Number(data.amount);
    let callbackUrl: string;
    try {
      callbackUrl = validateDevSimulatorConfig({
        appEnvironment: APP_ENV.value(),
        enabled: KCB_DEV_MOCK_ENABLED.value(),
        callbackUrl: KCB_TILL_CALLBACK_URL.value(),
        allowedOrigin: KCB_DEV_ALLOWED_CALLBACK_ORIGIN.value(),
      });
    } catch (error) {
      throw new HttpsError('failed-precondition', (error as Error).message);
    }
    let synthetic: ReturnType<typeof buildSyntheticTillPayload>;
    try {
      synthetic = buildSyntheticTillPayload(
        requestId, amount, KCB_SHARED_REFERENCE.value(),
      );
    } catch (error) {
      throw new HttpsError('invalid-argument', (error as Error).message);
    }
    const rawBodyText = JSON.stringify(synthetic.payload);
    const response = await fetch(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rawBodyText,
    });
    const responseBody = (await response.json()) as {
      header?: { statusCode?: unknown };
    };
    if (!response.ok || String(responseBody.header?.statusCode) !== '0') {
      logger.warn('Development KCB simulator callback was rejected.', {
        actorId, providerTransactionId: synthetic.providerTransactionId,
        status: response.status,
      });
      throw new HttpsError(
        'failed-precondition',
        'The deployed KCB callback rejected the synthetic notification.',
      );
    }
    logger.info('Development KCB simulator notification accepted.', {
      actorId, providerTransactionId: synthetic.providerTransactionId, amount,
    });
    return {
      requestId, providerTransactionId: synthetic.providerTransactionId,
      amount, status: 'unresolved', duplicateSafe: true,
    };
  },
);

// Stands in for KCB's token and STK endpoints. Point KCB_TOKEN_URL at
// `<url>/token` and KCB_STK_URL at `<url>/stkpush` in the development project
// only, and requestKcbStkPush runs exactly as in production.
export const kcbDevMockApi = onRequest(
  { secrets: [KCB_STK_CALLBACK_TOKEN] },
  async (request, response) => {
    try {
      validateDevSimulatorConfig({
        appEnvironment: APP_ENV.value(),
        enabled: KCB_DEV_MOCK_ENABLED.value(),
        callbackUrl: KCB_STK_CALLBACK_URL.value(),
        allowedOrigin: KCB_DEV_ALLOWED_CALLBACK_ORIGIN.value(),
        callbackFunction: 'kcbStkCallback',
      });
    } catch (error) {
      response.status(503).json({ error: (error as Error).message });
      return;
    }
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed.' });
      return;
    }
    const route = request.path.replace(/\/+$/, '');
    const authorization = request.get('Authorization') ?? '';
    if (route.endsWith('/token')) {
      if (!/^Basic \S+$/.test(authorization)) {
        response.status(401).json({ error: 'Basic credentials are required.' });
        return;
      }
      response.status(200).json(mockTokenResponse());
      return;
    }
    if (!route.endsWith('/stkpush')) {
      response.status(404).json({ error: 'Unknown mock KCB route.' });
      return;
    }
    if (!/^Bearer dev-[0-9a-f]+$/.test(authorization)) {
      response.status(401).json({ error: 'A mock access token is required.' });
      return;
    }
    let stkRequest: ReturnType<typeof parseMockStkPushRequest>;
    try {
      stkRequest = parseMockStkPushRequest(request.body);
    } catch (error) {
      response.status(400).json({
        header: { statusCode: '1', statusDescription: (error as Error).message },
      });
      return;
    }
    if (!stkPushCallbackIsTrusted({
      requestedCallbackUrl: stkRequest.callbackUrl,
      configuredCallbackUrl: KCB_STK_CALLBACK_URL.value(),
      callbackToken: KCB_STK_CALLBACK_TOKEN.value(),
    })) {
      logger.warn('Development KCB mock rejected an STK request with an untrusted callback.');
      response.status(403).json({
        header: { statusCode: '1', statusDescription: 'Untrusted callback.' },
      });
      return;
    }
    const prompt = newSimulatedStkPrompt(stkRequest);
    // requestKcbStkPush stores the invoice number before dispatching, so the
    // prompt can be tied to its request and member for authorization.
    const stkRequests = await db()
      .collection('kcb_stk_requests')
      .where('invoiceNumber', '==', stkRequest.invoiceNumber)
      .limit(1)
      .get();
    const stored = stkRequests.empty ? undefined : stkRequests.docs[0];
    await db().doc(`${STK_PROMPTS}/${prompt.checkoutRequestId}`).create({
      ...prompt,
      invoiceNumber: stkRequest.invoiceNumber,
      stkRequestId: stored?.id ?? null,
      memberId: stored?.get('memberId') ?? null,
      requestedBy: stored?.get('requestedBy') ?? null,
      purpose: stored?.get('purpose') ?? null,
      contributionId: stored?.get('contributionId') ?? null,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    logger.info('Development KCB mock recorded a simulated STK prompt.', {
      promptId: prompt.checkoutRequestId, stkRequestId: stored?.id ?? null,
      amount: prompt.amount,
    });
    const messageId = request.get('messageId') ?? prompt.merchantRequestId;
    response.status(200).json(mockStkPushResponse(prompt, messageId));
  },
);

type PromptData = {
  merchantRequestId: string;
  checkoutRequestId: string;
  phoneNumber: string;
  amount: number;
  stkRequestId: string | null;
  memberId: string | null;
  requestedBy: string | null;
  purpose: string | null;
  contributionId: string | null;
  status: string;
  outcome?: string;
  claimedAt?: admin.firestore.Timestamp;
  createdAt?: admin.firestore.Timestamp;
};

// Super admins may act on any prompt; a member only on prompts for their own
// account or that they requested, as if holding the phone.
const canActOnPrompt = (
  auth: { uid: string; token: Record<string, unknown> },
  prompt: Pick<PromptData, 'memberId' | 'requestedBy'>,
) =>
  isSuperAdmin(auth.token) ||
  prompt.memberId === auth.uid ||
  prompt.requestedBy === auth.uid;

export const listKcbDevStkPrompts = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in is required.');
  assertSimulatorEnabled();
  const auth = request.auth;
  const openStatuses = ['pending', 'resolving'];
  const prompts = db().collection(STK_PROMPTS);
  const ownerFields = isSuperAdmin(auth.token) ? [] : ['memberId', 'requestedBy'];
  const queries = ownerFields.length ?
    ownerFields.map((field) => prompts.where(field, '==', auth.uid)) :
      [prompts];
  const snapshots = await Promise.all(queries.map((item) =>
    item.where('status', 'in', openStatuses).limit(50).get()));
  const byId = new Map<string, PromptData>();
  snapshots.forEach((snapshot) => snapshot.docs.forEach((item) => {
    byId.set(item.id, item.data() as PromptData);
  }));
  const data = request.data as Data | undefined;
  const stkRequestId = typeof data?.stkRequestId === 'string' ? data.stkRequestId : undefined;
  return {
    prompts: [...byId.entries()]
      .filter(([, prompt]) => !stkRequestId || prompt.stkRequestId === stkRequestId)
      .sort(([, a], [, b]) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0))
      .map(([promptId, prompt]) => ({
        promptId,
        stkRequestId: prompt.stkRequestId,
        memberId: prompt.memberId,
        purpose: prompt.purpose,
        contributionId: prompt.contributionId,
        amount: prompt.amount,
        phoneNumber: prompt.phoneNumber,
        status: prompt.status,
        createdAt: prompt.createdAt?.toDate().toISOString() ?? null,
      })),
  };
});

export const resolveKcbDevStkPrompt = onCall(
  { secrets: [KCB_STK_CALLBACK_TOKEN] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in is required.');
    const auth = request.auth;
    const callbackUrl = new URL(stkCallbackUrl());
    const data = request.data as Data;
    const promptId = requiredString(data, 'promptId');
    const outcome = data.outcome;
    if (!isStkPromptOutcome(outcome)) {
      throw new HttpsError('invalid-argument', 'outcome must be approve, cancel or timeout.');
    }
    const promptRef = db().doc(`${STK_PROMPTS}/${promptId}`);
    const claim = await db().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(promptRef);
      if (!snapshot.exists) throw new HttpsError('not-found', 'Simulated prompt not found.');
      const prompt = snapshot.data() as PromptData;
      if (!canActOnPrompt(auth, prompt)) {
        throw new HttpsError('permission-denied', 'This simulated prompt belongs to another member.');
      }
      const decision = stkPromptResolutionDecision({
        status: prompt.status,
        storedOutcome: prompt.outcome,
        requestedOutcome: outcome,
        claimedAtMs: prompt.claimedAt?.toMillis(),
        nowMs: Date.now(),
      });
      if (decision.action === 'claim') {
        transaction.update(promptRef, {
          status: 'resolving',
          outcome,
          resolvedBy: auth.uid,
          claimedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      return { decision, prompt };
    });
    if (claim.decision.action === 'conflict') {
      throw new HttpsError(
        'failed-precondition',
        'This simulated prompt was already answered with a different outcome.',
      );
    }
    if (claim.decision.action !== 'claim') {
      return { promptId, outcome, status: claim.prompt.status, duplicate: true };
    }
    callbackUrl.searchParams.set('token', KCB_STK_CALLBACK_TOKEN.value());
    const payload = buildStkCallbackPayload(claim.prompt, outcome);
    let response: Response;
    try {
      response = await fetch(callbackUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      // The callback may have run, so the prompt stays claimed; once the claim
      // lapses it can be retried with the same outcome.
      logger.warn('Development KCB STK callback could not be reached.', {
        actorId: auth.uid, promptId, outcome,
      });
      throw new HttpsError('unavailable', 'The deployed KCB STK callback could not be reached.');
    }
    const responseBody = (await response.json().catch(() => ({}))) as { ResultCode?: unknown };
    if (!response.ok || Number(responseBody.ResultCode) !== 0) {
      logger.warn('Development KCB STK callback was rejected.', {
        actorId: auth.uid, promptId, outcome, status: response.status,
      });
      // An unauthorized callback recorded nothing, so the prompt can be
      // answered again. Any other failure keeps the claim as above, because
      // kcbStkCallback can fail after recording part of the result.
      if (response.status === 401) {
        await promptRef.update({
          status: 'pending',
          outcome: admin.firestore.FieldValue.delete(),
          resolvedBy: admin.firestore.FieldValue.delete(),
          claimedAt: admin.firestore.FieldValue.delete(),
        });
      }
      throw new HttpsError(
        response.status >= 500 ? 'unavailable' : 'failed-precondition',
        'The deployed KCB STK callback rejected the simulated result.',
      );
    }
    await promptRef.update({
      status: 'resolved',
      resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    logger.info('Development KCB STK prompt resolved.', {
      actorId: auth.uid, promptId, outcome, stkRequestId: claim.prompt.stkRequestId,
    });
    return { promptId, outcome, status: 'resolved', duplicate: false };
  },
);
