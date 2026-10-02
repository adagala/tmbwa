import { isMpesaReceiptNumber } from 'tmbwa-shared';

export type ContributionOption = {
  id: string;
  month: string;
  balance: number;
};

type ContributionDocument = {
  id: string;
  data: unknown;
};

type ContributionOptionsResult = {
  options: ContributionOption[];
  invalidDocumentCount: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const contributionOptionsFromDocuments = (
  documents: ContributionDocument[],
): ContributionOptionsResult => {
  const options: ContributionOption[] = [];
  let invalidDocumentCount = 0;

  documents.forEach(({ id, data }) => {
    if (!isRecord(data) || !Number.isFinite(data.balance)) {
      invalidDocumentCount += 1;
      return;
    }

    const balance = data.balance as number;
    if (balance <= 0) return;

    options.push({
      id,
      month:
        typeof data.month === 'string' && data.month.trim() ? data.month : id,
      balance,
    });
  });

  options.sort((left, right) => right.month.localeCompare(left.month));

  return { options, invalidDocumentCount };
};

export type KcbReceiptEvidence = {
  providerTransactionId: string;
  amount: number;
  currency: string;
  transactionDate: string;
  matchReason: string;
  requestedAmount?: number;
  source?: unknown;
  transactionType?: unknown;
  channelCode?: unknown;
  reconciliationWarning?: unknown;
  kcbTransactionReference?: string;
  conversationId?: unknown;
};

export type KcbReceiptSource = 'stk' | 'till';

export const kcbReceiptSource = (
  receipt: KcbReceiptEvidence,
): KcbReceiptSource =>
  receipt.source === 'stk_callback' ||
  receipt.transactionType === 'MPESA_STK' ||
  receipt.channelCode === 'stk'
    ? 'stk'
    : 'till';

// STK callbacks key the notification by MpesaReceiptNumber. Till IPNs are
// keyed by the M-Pesa receipt too when KCB sends one as the conversation ID,
// keeping the FT reference in kcbTransactionReference. Older Till IPNs are
// keyed by the FT reference but still carry the receipt as conversationId.
export const kcbMpesaCode = (receipt: KcbReceiptEvidence) => {
  if (kcbReceiptSource(receipt) === 'stk' || receipt.kcbTransactionReference) {
    return receipt.providerTransactionId;
  }
  return isMpesaReceiptNumber(receipt.conversationId)
    ? receipt.conversationId
    : undefined;
};

export const kcbTransactionReference = (receipt: KcbReceiptEvidence) =>
  receipt.kcbTransactionReference ??
  (kcbMpesaCode(receipt) === receipt.providerTransactionId
    ? undefined
    : receipt.providerTransactionId);

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// Mirrors parseKcbTransactionDate in functions/src/kcb/domain.ts.
export const parseKcbPaymentTime = (value: string) => {
  const stk = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value);
  const till =
    /^(?:\w{3} )?(\w{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) EAT (\d{4})$/.exec(
      value,
    );
  let parts: number[];
  if (stk) {
    const [, year, month, day, hour, minute, second] = stk;
    parts = [year, month, day, hour, minute, second].map(Number);
  } else if (till) {
    const [, month, day, hour, minute, second, year] = till;
    const monthIndex = MONTHS.indexOf(month);
    if (monthIndex < 0) return undefined;
    parts = [Number(year), monthIndex + 1, day, hour, minute, second].map(
      Number,
    );
  } else {
    return undefined;
  }
  const [year, month, day, hour, minute, second] = parts;
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return undefined;
  const date = new Date(
    Date.UTC(year, month - 1, day, hour - 3, minute, second),
  );
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const eatDate = new Intl.DateTimeFormat('en-KE', {
  timeZone: 'Africa/Nairobi',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const eatTime = new Intl.DateTimeFormat('en-KE', {
  timeZone: 'Africa/Nairobi',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export const formatEatDate = (date: Date) => eatDate.format(date);
export const formatEatTime = (date: Date) => `${eatTime.format(date)} EAT`;

export const formatReceiptDelay = (paidAt: Date, receivedAt: Date) => {
  const seconds = Math.round((receivedAt.getTime() - paidAt.getTime()) / 1000);
  if (seconds < 0) return undefined;
  if (seconds < 60) return `${seconds}s later`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min later`;
  return `${Math.round(seconds / 3600)} h later`;
};

export type KcbMatchHint = {
  variant: 'default' | 'warning' | 'error';
  title: string;
  message: string;
};

const kes = (value: number) => `KES ${value.toLocaleString('en-KE')}`;

export const kcbMatchHint = (
  receipt: KcbReceiptEvidence,
  suggestedMemberName?: string,
): KcbMatchHint | undefined => {
  if (receipt.reconciliationWarning === 'merchant_request_id_mismatch') {
    return {
      variant: 'error',
      title: 'STK request identifiers differ',
      message:
        'KCB confirmed this payment, but its merchant request ID does not match the stored STK request. Verify with KCB before reconciling.',
    };
  }
  if (receipt.matchReason === 'authenticated_stk_request_mismatch') {
    return receipt.requestedAmount && receipt.requestedAmount !== receipt.amount
      ? {
          variant: 'error',
          title: 'Amount differs from the STK request',
          message: `KCB confirmed ${kes(receipt.amount)}, but the STK request was for ${kes(receipt.requestedAmount)}. Anything you do not allocate stays as account credit.`,
        }
      : {
          variant: 'error',
          title: 'Payment details differ from the STK request',
          message:
            'KCB confirmed this payment, but its details do not match the stored STK request. Check the phone and member before reconciling.',
        };
  }
  if (receipt.matchReason === 'unique_verified_phone') {
    return {
      variant: 'warning',
      title: 'Suggested member',
      message: `${suggestedMemberName ?? 'One member'} has this verified phone. Confirm before reconciling.`,
    };
  }
  if (receipt.matchReason === 'ambiguous_phone_match') {
    return {
      variant: 'warning',
      title: 'Several members share this phone',
      message:
        'More than one member has this verified phone. Match on the payer name or the time paid.',
    };
  }
  if (receipt.matchReason === 'no_verified_phone_match') {
    return {
      variant: 'warning',
      title: 'No phone match',
      message:
        'No member has this verified phone. Match on the payer name or the time paid, or reject it with a reason.',
    };
  }
  return undefined;
};

type SearchableMember = {
  firstname: string;
  lastname: string;
  membernumber?: string;
  win?: string;
  phonenumber?: string;
};

const phoneDigits = (value: string) => value.replace(/[\s+\-()]/g, '');

export const memberSearchText = (member: SearchableMember) => {
  const digits = phoneDigits(member.phonenumber ?? '');
  return [
    member.firstname,
    member.lastname,
    member.membernumber,
    member.win,
    member.phonenumber,
    digits.slice(-9),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
};

// Phone queries match on the last nine digits so 07…, 2547… and +254 7…
// forms of the same number find each other.
export const matchesMemberSearch = (searchText: string, query: string) => {
  const normalized = query.trim().toLowerCase();
  const digits = phoneDigits(normalized);
  if (/^\d{9,12}$/.test(digits)) return searchText.includes(digits.slice(-9));
  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => searchText.includes(token));
};
