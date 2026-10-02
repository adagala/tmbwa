import { admin } from '../firebaseAdmin';
import {
  PAYMENT_STATUS,
  auditEventDocumentSchema,
  kcbPaymentNotificationDocumentSchema,
  notificationEventDocumentSchema,
  paymentDocumentSchema,
} from 'tmbwa-shared';
import { allocateTopUpToArrears } from '../financial/domain';
import {
  contributionData,
  memberData,
  validateDocumentWrite,
} from '../firestoreData';
import {
  ACCOUNT_TOP_UP_PURPOSE,
  isActiveStkRequestStatus,
  parseKcbTransactionDate,
  withoutReportedFieldsAlreadySet,
} from './domain';

const db = () => admin.firestore();

export const stkTopUpLockRef = (memberId: string) =>
  db().doc(`members/${memberId}/payment_locks/stk_top_up`);

const stkContributionLockRef = (memberId: string, contributionId: string) =>
  db().doc(
    `members/${memberId}/contributions/${contributionId}/payment_locks/stk`,
  );

const isActiveLock = (snapshot: FirebaseFirestore.DocumentSnapshot) => {
  const status = snapshot.data()?.status;
  return typeof status === 'string' && isActiveStkRequestStatus(status);
};

// Reads a member's outstanding contributions and their STK locks. Must run
// before any transaction writes.
export const readOutstandingContributions = async (
  transaction: FirebaseFirestore.Transaction,
  memberId: string,
) => {
  const snapshot = await transaction.get(
    db().collection(`members/${memberId}/contributions`).where('balance', '>', 0),
  );
  const locks = await Promise.all(
    snapshot.docs.map((item) =>
      transaction.get(stkContributionLockRef(memberId, item.id))),
  );
  return snapshot.docs.map((item, index) => ({
    ref: item.ref,
    contribution: contributionData(item),
    hasActiveStkLock: isActiveLock(locks[index]),
  }));
};

export type TopUpState = {
  memberRef: FirebaseFirestore.DocumentReference;
  member: ReturnType<typeof memberData>;
  outstanding: Awaited<ReturnType<typeof readOutstandingContributions>>;
};

// Reads everything a top-up needs; undefined when the member is missing.
export const readTopUpState = async (
  transaction: FirebaseFirestore.Transaction,
  memberId: string,
): Promise<TopUpState | undefined> => {
  const memberRef = db().doc(`members/${memberId}`);
  const memberSnapshot = await transaction.get(memberRef);
  if (!memberSnapshot.exists) return undefined;
  return {
    memberRef,
    member: memberData(memberSnapshot),
    outstanding: await readOutstandingContributions(transaction, memberId),
  };
};

// Records one top-up receipt: settles arrears oldest first and leaves the
// remainder as unreserved credit for future contributions.
export const recordStkTopUp = (
  transaction: FirebaseFirestore.Transaction,
  state: TopUpState,
  args: {
    memberId: string;
    stkRequestId: string;
    stkRequestRef: FirebaseFirestore.DocumentReference;
    stkRequestUpdate?: Record<string, unknown>;
    ownsLock: boolean;
    paymentId: string;
    amount: number;
    requestedAmount: number;
    providerTransactionId: string;
    transactionDate: string;
    payerPhone: string;
    messageId: string;
    billReference: string;
    currency: string;
    notificationRef: FirebaseFirestore.DocumentReference;
    notificationExists: boolean;
    // The document being written onto; its reported payment details are kept.
    existingNotification?: Record<string, unknown>;
    notificationIdentifiers?: Record<string, unknown>;
    notificationReceivedAt?: unknown;
    actorId: string;
    // Set when an officer acts; absent for system callbacks.
    actorRoles?: string[];
    auditPath: string;
    auditRequestId: string;
    auditChanges?: Record<string, unknown>;
  },
) => {
  // A contribution with its own in-flight STK prompt keeps its balance for
  // that prompt; its share of the top-up stays as credit instead.
  const eligible = state.outstanding.filter((item) => !item.hasActiveStkLock);
  const result = allocateTopUpToArrears(
    args.amount,
    eligible.map((item) => ({
      contributionId: item.ref.id,
      month: item.contribution.month,
      balance: Number(item.contribution.balance),
    })),
  );
  const receiptNumber = `TMBWA-${args.paymentId.toUpperCase()}`;
  const paymentPath = `members/${args.memberId}/payments/${args.paymentId}`;
  const payment = validateDocumentWrite(
    paymentDocumentSchema,
    {
      payment_id: args.paymentId,
      referencenumber: args.providerTransactionId,
      amount: args.amount,
      paymentdate: admin.firestore.Timestamp.fromDate(
        parseKcbTransactionDate(args.transactionDate),
      ),
      created_at: admin.firestore.Timestamp.now(),
      member_id: args.memberId,
      contribution_id: result.allocations[0]?.contributionId ?? '',
      firstname: state.member.firstname,
      lastname: state.member.lastname,
      contribution_amount: result.allocatedAmount,
      payment_type: result.allocations.length ? 'contribution' : 'account',
      payment_purpose: ACCOUNT_TOP_UP_PURPOSE,
      allocations: result.allocations.map((item) => ({
        contribution_id: item.contributionId,
        amount: item.amount,
      })),
      unallocated_amount: result.unallocatedAmount,
      credit_reserved: false,
      payment_source: 'kcb_buni',
      provider_transaction_id: args.providerTransactionId,
      payer_phone: args.payerPhone,
      action_by: args.actorId,
      request_id: args.stkRequestId,
      receipt_number: receiptNumber,
    },
    paymentPath,
  );
  transaction.create(db().doc(paymentPath), payment);
  result.allocations.forEach((allocation) => {
    const item = eligible.find(
      (candidate) => candidate.ref.id === allocation.contributionId,
    );
    if (!item) throw new Error('Top-up allocation target is missing.');
    const remaining = Number(item.contribution.balance) - allocation.amount;
    transaction.update(item.ref, {
      payments: admin.firestore.FieldValue.arrayUnion({
        ...payment,
        contribution_id: allocation.contributionId,
        contribution_amount: allocation.amount,
      }),
      balance: remaining,
      paid: remaining === 0 ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.PARTIAL,
    });
    transaction.set(db().doc(`monthly_stats/${allocation.contributionId}`), {
      contribution: admin.firestore.FieldValue.increment(allocation.amount),
      month: allocation.contributionId,
    }, { merge: true });
  });
  // The remainder is deliberately not added to reservedKcbCredit so that
  // contribution generation applies it automatically.
  transaction.update(state.memberRef, {
    balance: admin.firestore.FieldValue.increment(args.amount),
    contributionBalance: admin.firestore.FieldValue.increment(
      result.allocatedAmount,
    ),
  });
  const notification = validateDocumentWrite(
    kcbPaymentNotificationDocumentSchema,
    {
      providerTransactionId: args.providerTransactionId,
      messageId: args.messageId,
      channelCode: 'stk',
      billReference: args.billReference,
      payerPhone: args.payerPhone,
      payerName: '',
      amount: args.amount,
      currency: args.currency,
      transactionDate: args.transactionDate,
      transactionType: 'MPESA_STK',
      ...args.notificationIdentifiers,
      status: 'reconciled',
      suggestedMemberId: args.memberId,
      memberId: args.memberId,
      purpose: ACCOUNT_TOP_UP_PURPOSE,
      matchReason: 'authenticated_stk_top_up',
      provider: 'kcb_buni',
      source: 'stk_callback',
      stkRequestId: args.stkRequestId,
      requestedAmount: args.requestedAmount,
      allocations: result.allocations,
      unallocatedAmount: result.unallocatedAmount,
      creditReserved: false,
      paymentId: args.paymentId,
      receiptNumber,
      receivedAt: args.notificationReceivedAt ??
        admin.firestore.FieldValue.serverTimestamp(),
      reconciledAt: admin.firestore.FieldValue.serverTimestamp(),
      reconciledBy: args.actorId,
    },
    args.notificationRef.path,
  );
  if (args.notificationExists) {
    transaction.set(
      args.notificationRef,
      withoutReportedFieldsAlreadySet(notification, args.existingNotification),
      { merge: true },
    );
  } else {
    transaction.create(args.notificationRef, notification);
  }
  transaction.update(args.stkRequestRef, {
    ...args.stkRequestUpdate,
    status: 'reconciled',
    providerTransactionId: args.providerTransactionId,
    reconciledAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  if (args.ownsLock) {
    transaction.update(stkTopUpLockRef(args.memberId), {
      status: 'reconciled',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  transaction.create(
    db().doc(args.auditPath),
    validateDocumentWrite(
      auditEventDocumentSchema,
      {
        requestId: args.auditRequestId,
        actorId: args.actorId,
        ...(args.actorRoles && { actorRoles: args.actorRoles }),
        action: 'kcb_payment.top_up_reconciled',
        memberId: args.memberId,
        targetId: args.paymentId,
        changes: {
          ...args.auditChanges,
          providerTransactionId: args.providerTransactionId,
          stkRequestId: args.stkRequestId,
          amount: args.amount,
          allocations: result.allocations,
          unallocatedAmount: result.unallocatedAmount,
          receiptNumber,
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      args.auditPath,
    ),
  );
  const eventPath = `notification_events/payment-reconciled-${args.paymentId}`;
  transaction.create(
    db().doc(eventPath),
    validateDocumentWrite(
      notificationEventDocumentSchema,
      {
        type: 'payment.reconciled',
        memberId: args.memberId,
        paymentId: args.paymentId,
        receiptNumber,
        amount: args.amount,
        source: 'kcb_buni',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      eventPath,
    ),
  );
  return { receiptNumber, ...result };
};
