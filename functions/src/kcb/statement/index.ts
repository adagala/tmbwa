import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import {
  KcbStatementParseError,
  auditEventDocumentSchema,
  kcbPaymentNotificationDocumentSchema,
  kcbStatementImportDocumentSchema,
  kcbStatementImportRunDocumentSchema,
  normalizeMpesaReference,
  parseKcbStatement,
  validateKcbStatement,
  type KcbStatement,
  type KcbStatementTransaction,
} from 'tmbwa-shared';
import { admin } from '../../firebaseAdmin';
import { type Actor, reauthorizeActor, requirePermission } from '../../authorization';
import { validateDocumentWrite } from '../../firestoreData';
import { normalizeKenyanPhone, parseKcbTransactionDate } from '../domain';
import { extractPdfText } from './pdf';

export { markKcbPaymentAlreadyRecorded, undoKcbPaymentAlreadyRecorded } from './alreadyRecorded';
import {
  type ReferencePayment,
  type StatementRowOutcome,
  importSelection,
  referenceMatch,
  statementAmount,
  statementPdfBytes,
  statementTransactionDate,
} from './domain';

// Imports historical M-Pesa credits from a KCB account statement PDF (#94).
// The server parses the uploaded PDF itself, refuses it unless the statement
// balances exactly, skips every payment the app already knows, and creates
// the rest as unresolved KCB payment notifications for reconciliation. The PDF
// is kept in Storage as evidence. No balance changes here.

// The association's KCB account number. Imports are refused until it is set.
const KCB_STATEMENT_ACCOUNT_NUMBER = defineString('KCB_STATEMENT_ACCOUNT_NUMBER', { default: '' });

const db = () => admin.firestore();
const ROW_CONCURRENCY = 10;

type Data = Record<string, unknown>;

type Reader = {
  doc: (ref: FirebaseFirestore.DocumentReference) => Promise<FirebaseFirestore.DocumentSnapshot>;
  query: (query: FirebaseFirestore.Query) => Promise<FirebaseFirestore.QuerySnapshot>;
};

const directReader: Reader = { doc: (ref) => ref.get(), query: (query) => query.get() };
const transactionReader = (transaction: FirebaseFirestore.Transaction): Reader => ({
  doc: (ref) => transaction.get(ref),
  query: (query) => transaction.get(query),
});

const statementPdfPath = (fileHash: string) => `kcb_statements/${fileHash}.pdf`;

const fileNameValue = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : 'statement.pdf';

const readStatement = async (data: Data) => {
  let bytes: Buffer;
  try {
    bytes = statementPdfBytes(data.pdfBase64);
  } catch (error) {
    throw new HttpsError('invalid-argument', (error as Error).message);
  }
  const expectedAccountNumber = KCB_STATEMENT_ACCOUNT_NUMBER.value().trim();
  if (!expectedAccountNumber) {
    throw new HttpsError('failed-precondition', 'Statement imports are not configured.');
  }
  let text: string;
  try {
    text = await extractPdfText(bytes);
  } catch {
    throw new HttpsError('invalid-argument', 'The PDF could not be read.');
  }
  let statement: KcbStatement;
  try {
    statement = parseKcbStatement(text);
  } catch (error) {
    if (error instanceof KcbStatementParseError) throw new HttpsError('invalid-argument', error.message);
    throw error;
  }
  return {
    bytes,
    statement,
    fileHash: createHash('sha256').update(bytes).digest('hex'),
    problems: validateKcbStatement(statement, { expectedAccountNumber }),
  };
};

const payerPhoneValue = (phone: string) => {
  try {
    return normalizeKenyanPhone(phone);
  } catch {
    return undefined;
  }
};

type RowClassification = {
  outcome: StatementRowOutcome;
  reason?: string;
  notificationId?: string;
  // An earlier run of this import created the notification.
  importedEarlier?: boolean;
  matchedPaymentPaths?: string[];
  matchedMemberIds?: string[];
  payerPhone?: string;
  suggestedMemberId?: string | null;
  matchReason?: string;
};

// What the import would do with one statement row, from the app's current
// data. Reads only, so it can run inside the import's transaction.
const classifyRow = async (
  reader: Reader,
  transaction: KcbStatementTransaction,
  importId: string,
): Promise<RowClassification> => {
  if (transaction.kind !== 'mpesa_credit' || !transaction.mpesa) {
    return {
      outcome: 'ignored',
      reason: transaction.kind === 'opening_balance' ? 'opening_balance' : 'not_mpesa_credit',
    };
  }
  const receipt = normalizeMpesaReference(transaction.mpesa.receipt) ?? transaction.mpesa.receipt;
  const bankReference = transaction.bankReference;
  const notifications = db().collection('kcb_payment_notifications');
  const [byReceipt, byBankReference, byReceiptField, byBankReferenceField] = await Promise.all([
    reader.doc(notifications.doc(receipt)),
    bankReference ? reader.doc(notifications.doc(bankReference)) : undefined,
    reader.query(notifications.where('mpesaReceiptNumber', '==', receipt).limit(1)),
    bankReference
      ? reader.query(notifications.where('kcbTransactionReference', '==', bankReference).limit(1))
      : undefined,
  ]);
  const existing = [byReceipt, byBankReference, byReceiptField?.docs[0], byBankReferenceField?.docs[0]]
    .find((snapshot) => snapshot?.exists);
  if (existing) {
    const importedEarlier = existing.get('source') === 'statement_import' && existing.get('importId') === importId;
    return {
      outcome: 'already_in_app',
      reason: importedEarlier ? 'imported_earlier' : 'kcb_notification',
      notificationId: existing.id,
      importedEarlier,
    };
  }

  const amount = statementAmount(transaction);
  const payerPhone = payerPhoneValue(transaction.mpesa.payerPhone);
  const paymentsSnapshot = await reader.query(
    db().collectionGroup('payments').where('referenceNormalized', '==', receipt).limit(20),
  );
  const paymentDocs = paymentsSnapshot.docs.filter((doc) => doc.ref.parent.parent?.parent.id === 'members');
  const memberIds = [...new Set(paymentDocs.map((doc) => doc.ref.parent.parent?.id ?? ''))];
  const memberSnapshots = await Promise.all(memberIds.map((id) => reader.doc(db().doc(`members/${id}`))));
  const memberPhones = new Map(memberSnapshots.map((snapshot) => [snapshot.id, snapshot.get('phoneNormalized')]));
  const payments: ReferencePayment[] = paymentDocs.map((doc) => {
    const memberId = doc.ref.parent.parent?.id ?? '';
    return { path: doc.ref.path, memberId, amount: Number(doc.get('amount')), memberPhone: memberPhones.get(memberId) };
  });
  const match = referenceMatch({ amount, payerPhone }, payments);
  if (match.kind === 'recorded') {
    return {
      outcome: 'already_in_app',
      reason: 'recorded_payment',
      matchedPaymentPaths: match.paths,
      matchedMemberIds: [match.memberId],
    };
  }

  // Only a suggestion, as for Till notifications: the treasurer confirms the
  // member when reconciling, and a shared number suggests no one.
  const matches = payerPhone
    ? await reader.query(db().collection('members').where('phoneNormalized', '==', payerPhone).limit(2))
    : undefined;
  const suggestedMemberId = matches?.size === 1 ? matches.docs[0].id : null;
  const suggestion = {
    payerPhone,
    suggestedMemberId,
    matchReason: suggestedMemberId
      ? 'unique_profile_phone'
      : matches && !matches.empty ? 'ambiguous_phone_match' : 'no_verified_phone_match',
  };
  if (match.kind === 'check') {
    return {
      outcome: 'matched_check',
      reason: match.reason,
      matchedPaymentPaths: match.paths,
      matchedMemberIds: match.memberIds,
      ...suggestion,
    };
  }
  return { outcome: 'new', ...suggestion };
};

const previewRow = (transaction: KcbStatementTransaction, classification: RowClassification) => ({
  index: transaction.index,
  transactionDate: transaction.transactionDate,
  details: transaction.details,
  moneyIn: transaction.moneyInCents / 100,
  moneyOut: transaction.moneyOutCents / 100,
  ...(transaction.bankReference ? { bankReference: transaction.bankReference } : {}),
  ...(transaction.mpesa ? {
    receipt: transaction.mpesa.receipt,
    channel: transaction.mpesa.channel,
    payerPhone: transaction.mpesa.payerPhone,
    payerName: transaction.mpesa.payerName,
  } : {}),
  outcome: classification.outcome,
  ...(classification.reason ? { reason: classification.reason } : {}),
  ...(classification.notificationId ? { notificationId: classification.notificationId } : {}),
  ...(classification.matchedPaymentPaths ? { matchedPaymentPaths: classification.matchedPaymentPaths } : {}),
  ...(classification.matchedMemberIds ? { matchedMemberIds: classification.matchedMemberIds } : {}),
  ...(classification.suggestedMemberId ? { suggestedMemberId: classification.suggestedMemberId } : {}),
});

const inChunks = async <Item, Result>(items: Item[], size: number, run: (item: Item) => Promise<Result>) => {
  const results: Result[] = [];
  for (let start = 0; start < items.length; start += size) {
    results.push(...await Promise.all(items.slice(start, start + size).map(run)));
  }
  return results;
};

const headerSummary = (statement: KcbStatement) => ({
  accountNumber: statement.header.accountNumber,
  periodStart: statement.header.periodStart,
  periodEnd: statement.header.periodEnd,
  openingBalanceCents: statement.header.openingBalanceCents,
  closingBalanceCents: statement.header.closingBalanceCents,
  totalMoneyInCents: statement.header.totalMoneyInCents,
  totalMoneyOutCents: statement.header.totalMoneyOutCents,
  transactionCount: statement.transactions.length,
});

// Read-only: parses and checks an uploaded statement and reports what an
// import would do with each row.
export const previewKcbStatement = onCall({ timeoutSeconds: 300, memory: '1GiB' }, async (request) => {
  await requirePermission(request.auth, 'kcb.reconcile');
  const { statement, fileHash, problems } = await readStatement(request.data as Data);
  const base = { importId: fileHash, header: headerSummary(statement), problems };
  if (problems.length) return { ...base, rows: [] };
  const rows = await inChunks(statement.transactions, ROW_CONCURRENCY, async (transaction) =>
    previewRow(transaction, await classifyRow(directReader, transaction, fileHash)));
  return { ...base, rows };
});

const storeStatementPdf = async (fileHash: string, bytes: Buffer, actorId: string) => {
  const file = admin.storage().bucket().file(statementPdfPath(fileHash));
  const [exists] = await file.exists();
  if (exists) return;
  await file.save(bytes, {
    resumable: false,
    contentType: 'application/pdf',
    metadata: { metadata: { sha256: fileHash, uploadedBy: actorId } },
  });
};

type ImportedRow = {
  index: number;
  outcome: 'imported' | 'already_in_app';
  reason?: string;
  receipt: string;
  bankReference?: string;
  notificationId?: string;
  matchedPaymentPaths?: string[];
};

// Imports one selected payment, unless the app already has it. A selected
// payment that needs a check is imported: selecting it is the treasurer's
// decision.
const importRow = (
  actor: Actor,
  transaction: KcbStatementTransaction & { mpesa: NonNullable<KcbStatementTransaction['mpesa']> },
  importId: string,
  runId: string,
) => db().runTransaction(async (firestoreTransaction): Promise<ImportedRow> => {
  await reauthorizeActor(firestoreTransaction, actor);
  const classification = await classifyRow(transactionReader(firestoreTransaction), transaction, importId);
  const receipt = normalizeMpesaReference(transaction.mpesa.receipt) ?? transaction.mpesa.receipt;
  const base = {
    index: transaction.index,
    receipt,
    ...(transaction.bankReference ? { bankReference: transaction.bankReference } : {}),
  };
  if (classification.outcome === 'already_in_app' || classification.outcome === 'ignored') {
    return {
      ...base,
      outcome: classification.importedEarlier ? 'imported' : 'already_in_app',
      ...(classification.reason && !classification.importedEarlier ? { reason: classification.reason } : {}),
      ...(classification.notificationId ? { notificationId: classification.notificationId } : {}),
      ...(classification.matchedPaymentPaths ? { matchedPaymentPaths: classification.matchedPaymentPaths } : {}),
    };
  }

  const transactionDate = statementTransactionDate(transaction.transactionDate);
  const notificationRef = db().doc(`kcb_payment_notifications/${receipt}`);
  firestoreTransaction.create(notificationRef, validateDocumentWrite(
    kcbPaymentNotificationDocumentSchema,
    {
      payerPhone: classification.payerPhone ?? transaction.mpesa.payerPhone,
      payerName: transaction.mpesa.payerName,
      amount: statementAmount(transaction),
      currency: 'KES',
      billReference: transaction.mpesa.businessNumber,
      transactionDate,
      paidAt: admin.firestore.Timestamp.fromDate(parseKcbTransactionDate(transactionDate)),
      status: 'unresolved',
      suggestedMemberId: classification.suggestedMemberId ?? null,
      matchReason: classification.matchReason ?? 'no_verified_phone_match',
      receivedAt: admin.firestore.FieldValue.serverTimestamp(),
      provider: 'kcb_buni',
      source: 'statement_import',
      providerTransactionId: receipt,
      mpesaReceiptNumber: receipt,
      ...(transaction.bankReference ? { kcbTransactionReference: transaction.bankReference } : {}),
      importId,
      importRunId: runId,
      statementDate: transaction.transactionDate,
      importedBy: actor.actorId,
      ...(classification.outcome === 'matched_check' ? {
        referenceCheck: {
          reason: classification.reason,
          matchedPaymentPaths: classification.matchedPaymentPaths ?? [],
        },
      } : {}),
    },
    notificationRef.path,
  ));
  return {
    ...base,
    outcome: 'imported',
    notificationId: receipt,
    ...(classification.outcome === 'matched_check' ? { reason: `checked_${classification.reason}` } : {}),
  };
});

const sameSelection = (stored: unknown, receipts: Set<string>) =>
  Array.isArray(stored) && stored.length === receipts.size && stored.every((receipt) => receipts.has(receipt));

// Imports the payments the treasurer selected from a statement, optionally
// within a date range (#100). Each call is a run keyed by its requestId:
// repeating a run returns its result, an interrupted run resumes, and the
// same statement can be imported again with another selection. A payment is
// never imported twice: its notification is keyed by M-Pesa receipt.
export const importKcbStatement = onCall({ timeoutSeconds: 540, memory: '1GiB' }, async (request) => {
  const actor = await requirePermission(request.auth, 'kcb.reconcile');
  const data = request.data as Data;
  const runId = typeof data.requestId === 'string' ? data.requestId.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(runId)) {
    throw new HttpsError('invalid-argument', 'requestId is required.');
  }
  const { bytes, statement, fileHash, problems } = await readStatement(data);
  if (problems.length) {
    throw new HttpsError(
      'failed-precondition',
      `The statement does not balance or is for another account: ${problems.map((item) => item.message).join(' ')}`,
    );
  }
  let selection: ReturnType<typeof importSelection>;
  try {
    selection = importSelection(statement.transactions, {
      receipts: data.receipts, fromDate: data.fromDate, toDate: data.toDate,
    });
  } catch (error) {
    throw new HttpsError('invalid-argument', (error as Error).message);
  }
  const importId = fileHash;
  const statementRef = db().doc(`kcb_statement_imports/${importId}`);
  const runRef = statementRef.collection('runs').doc(runId);

  // Starts, or resumes, the run. Nothing is written for an officer whose
  // access changed after requirePermission.
  const started = await db().runTransaction(async (transaction) => {
    await reauthorizeActor(transaction, actor);
    const [statementSnapshot, run] = await Promise.all([transaction.get(statementRef), transaction.get(runRef)]);
    if (run.exists && !sameSelection(run.get('receipts'), selection.receipts)) {
      throw new HttpsError('failed-precondition', 'This requestId was already used for another selection.');
    }
    if (run.get('status') === 'completed') return { completed: true, counts: run.get('counts') ?? {} };
    if (!statementSnapshot.exists) {
      transaction.create(statementRef, validateDocumentWrite(kcbStatementImportDocumentSchema, {
        fileHash,
        fileName: fileNameValue(data.fileName),
        storagePath: statementPdfPath(fileHash),
        ...headerSummary(statement),
        importedBy: actor.actorId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }, statementRef.path));
    }
    if (!run.exists) {
      transaction.create(runRef, validateDocumentWrite(kcbStatementImportRunDocumentSchema, {
        requestId: runId,
        importId,
        status: 'importing',
        receipts: [...selection.receipts],
        ...(selection.fromDate ? { fromDate: selection.fromDate } : {}),
        ...(selection.toDate ? { toDate: selection.toDate } : {}),
        importedBy: actor.actorId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }, runRef.path));
    }
    return { completed: false, counts: {} };
  });
  if (started.completed) return { importId, runId, duplicate: true, counts: started.counts };

  // Kept before any notification exists, so every imported payment has its
  // evidence. A resumed run stores it if an earlier attempt could not.
  await storeStatementPdf(fileHash, bytes, actor.actorId);

  const selected = statement.transactions.filter((transaction) =>
    transaction.kind === 'mpesa_credit' && transaction.mpesa &&
    selection.receipts.has(normalizeMpesaReference(transaction.mpesa.receipt) ?? ''));
  const rows = await inChunks(selected, ROW_CONCURRENCY, (transaction) =>
    importRow(actor, transaction as Parameters<typeof importRow>[1], importId, runId));
  const counts: Record<string, number> = {
    imported: rows.filter((row) => row.outcome === 'imported').length,
    already_in_app: rows.filter((row) => row.outcome === 'already_in_app').length,
    not_selected: statement.transactions.filter((transaction) => transaction.kind === 'mpesa_credit').length -
      selected.length,
    ignored: statement.transactions.filter((transaction) => transaction.kind !== 'mpesa_credit').length,
  };

  await db().runTransaction(async (transaction) => {
    await reauthorizeActor(transaction, actor);
    const current = await transaction.get(runRef);
    if (current.get('status') === 'completed') return;
    transaction.update(runRef, {
      status: 'completed',
      counts,
      rows,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.update(statementRef, {
      lastImportedBy: actor.actorId,
      lastImportedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const auditId = `kcb-statement-imported-${runId}`;
    transaction.create(db().doc(`audit_events/${auditId}`), validateDocumentWrite(auditEventDocumentSchema, {
      requestId: auditId,
      actorId: actor.actorId,
      actorRoles: actor.actorRoles,
      action: 'kcb_statement.imported',
      memberId: '',
      targetId: importId,
      changes: {
        runId,
        periodStart: statement.header.periodStart,
        periodEnd: statement.header.periodEnd,
        fromDate: selection.fromDate ?? null,
        toDate: selection.toDate ?? null,
        selectedCount: selection.receipts.size,
        counts,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, `audit_events/${auditId}`));
  });
  return { importId, runId, duplicate: false, counts };
});
