import { createHash } from 'crypto';

type DevSimulatorConfig = {
  appEnvironment: string;
  enabled: string;
  callbackUrl: string;
  allowedOrigin: string;
  // The deployed callback function the simulator may post to.
  callbackFunction?: 'kcbTillNotification' | 'kcbStkCallback';
};

export const assertDevSimulatorEnabled = (
  { appEnvironment, enabled }: { appEnvironment: string; enabled: string },
) => {
  if (appEnvironment !== 'development' || enabled !== 'true') {
    throw new Error('The KCB simulator is disabled outside the development environment.');
  }
};

export const validateDevSimulatorConfig = ({
  appEnvironment, enabled, callbackUrl, allowedOrigin,
  callbackFunction = 'kcbTillNotification',
}: DevSimulatorConfig) => {
  assertDevSimulatorEnabled({ appEnvironment, enabled });
  const callback = new URL(callbackUrl);
  const allowed = new URL(allowedOrigin);
  if (callback.protocol !== 'https:' || allowed.protocol !== 'https:') {
    throw new Error('KCB development callback configuration must use HTTPS.');
  }
  if (callback.origin !== allowed.origin) {
    throw new Error('KCB development callback origin is not allowed.');
  }
  if (!callback.pathname.endsWith(`/${callbackFunction}`)) {
    throw new Error(`KCB development callback must target ${callbackFunction}.`);
  }
  return callback.toString();
};

export const devProviderTransactionId = (requestId: string) => {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) {
    throw new Error('Invalid simulator request ID.');
  }
  return `DEV${createHash('sha256').update(requestId).digest('hex').slice(0, 17).toUpperCase()}`;
};

// KCB's compact `yyyyMMddHHmmss` timestamp in Nairobi time.
export const nairobiCompactTimestamp = (now: Date) => {
  const timestamp = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now).reduce<Record<string, string>>((parts, item) => {
    if (item.type !== 'literal') parts[item.type] = item.value;
    return parts;
  }, {});
  return `${timestamp.year}${timestamp.month}${timestamp.day}${timestamp.hour}${timestamp.minute}${timestamp.second}`;
};

export const buildSyntheticTillPayload = (
  requestId: string,
  amount: number,
  sharedReference: string,
  now = new Date(),
) => {
  if (!Number.isInteger(amount) || amount < 1 || amount > 10000) {
    throw new Error('Development test amount must be a whole number from 1 to 10,000.');
  }
  const providerTransactionId = devProviderTransactionId(requestId);
  const compactTimestamp = nairobiCompactTimestamp(now);
  return {
    providerTransactionId,
    payload: {
      header: {
        messageID: `DEV-${providerTransactionId}`,
        originatorConversationID: `DEV-${requestId.slice(0, 24)}`,
        channelCode: '202',
        timeStamp: compactTimestamp,
      },
      requestPayload: {
        primaryData: { businessKey: '522533', businessKeyType: 'BillerID' },
        additionalData: { notificationData: {
          businessKey: sharedReference,
          businessKeyType: 'BillReferenceNumber',
          debitMSISDN: '254700000001',
          transactionAmt: String(amount),
          transactionDate: compactTimestamp,
          transactionID: providerTransactionId,
          firstName: 'TMBWA', middleName: 'DEV', lastName: 'TEST',
          currency: 'KES', narration: 'Synthetic development payment',
          transactionType: 'MPESA', balance: '0',
        } },
      },
    },
  };
};
