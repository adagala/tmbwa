import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  buildSyntheticTillPayload,
  signSyntheticPayload,
  validateDevSimulatorConfig,
} from './devSimulator';

type Data = Record<string, unknown>;

const KCB_DEV_PRIVATE_KEY = defineSecret('KCB_DEV_PRIVATE_KEY');
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

const requireAdministrator = (
  auth: { uid: string; token: Record<string, unknown> } | undefined,
) => {
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in is required.');
  if (auth.token.role !== 'administrator') {
    throw new HttpsError('permission-denied', 'Administrator access is required.');
  }
  return auth.uid;
};

const requiredString = (data: Data, key: string) => {
  const value = data[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpsError('invalid-argument', `${key} is required.`);
  }
  return value.trim();
};

export const sendKcbDevTillNotification = onCall(
  { secrets: [KCB_DEV_PRIVATE_KEY] },
  async (request) => {
    const actorId = requireAdministrator(request.auth);
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
    let signature: string;
    try {
      signature = signSyntheticPayload(
        Buffer.from(rawBodyText, 'utf8'), KCB_DEV_PRIVATE_KEY.value(),
      );
    } catch {
      throw new HttpsError('failed-precondition', 'The development signing key is invalid.');
    }
    const response = await fetch(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Signature: signature },
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
