import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import {
  KcbStatementParseError,
  auditEventDocumentSchema,
  kcbPaymentNotificationDocumentSchema,
  kcbStatementImportDocumentSchema,
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
import {
  type ReferencePayment,
  type StatementRowOutcome,
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
const MAX_RECEIPTS_TO_INCLUDE = 1000;

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
  const importSnapshot = await db().doc(`kcb_statement_imports/${fileHash}`).get();
  const base = {
    importId: fileHash,
    importStatus: importSnapshot.exists ? importSnapshot.get('status') : null,
    header: headerSummary(statement),
    problems,
  };
  if (problems.length) return { ...base, rows: [] };
  const rows = await inChunks(statement.transactions, ROW_CONCURRENCY, async (transaction) =>
    previewRow(transaction, await classifyRow(directReader, transaction, fileHash)));
  return { ...base, rows };
});

const receiptsToInclude = (value: unknown) => {
  if (value === undefined) return new Set<string>();
  if (
    !Array.isArray(value) ||
    value.length > MAX_RECEIPTS_TO_INCLUDE ||
    !value.every((item) => typeof item === 'string' && normalizeMpesaReference(item))
  ) {
    throw new HttpsError('invalid-argument', 'includeReceipts must be a list of M-Pesa receipts.');
  }
  return new Set(value.map((item) => normalizeMpesaReference(item) as string));
};

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
  outcome: 'imported' | 'already_in_app' | 'matched_check' | 'ignored';
  reason?: string;
  receipt?: string;
  bankReference?: string;
  notificationId?: string;
  matchedPaymentPaths?: string[];
};

const importRow = (
  actor: Actor,
  transaction: KcbStatementTransaction,
  importId: string,
  includeReceipts: Set<string>,
) => db().runTransaction(async (firestoreTransaction): Promise<ImportedRow> => {
  await reauthorizeActor(firestoreTransaction, actor);
  const classification = await classifyRow(transactionReader(firestoreTransaction), transaction, importId);
  const receipt = transaction.mpesa
    ? normalizeMpesaReference(transaction.mpesa.receipt) ?? transaction.mpesa.receipt
    : undefined;
  const row: ImportedRow = {
    index: transaction.index,
    outcome: classification.importedEarlier ? 'imported' : classification.outcome === 'new' ? 'imported'
      : classification.outcome,
    ...(classification.reason && !classification.importedEarlier ? { reason: classification.reason } : {}),
    ...(receipt ? { receipt } : {}),
    ...(transaction.bankReference ? { bankReference: transaction.bankReference } : {}),
    ...(classification.notificationId ? { notificationId: classification.notificationId } : {}),
    ...(classification.matchedPaymentPaths ? { matchedPaymentPaths: classification.matchedPaymentPaths } : {}),
  };
  const create =
    classification.outcome === 'new' ||
    (classification.outcome === 'matched_check' && receipt !== undefined && includeReceipts.has(receipt));
  if (!create || !receipt || !transaction.mpesa) return row;

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
    ...row,
    outcome: 'imported',
    notificationId: receipt,
    ...(classification.outcome === 'matched_check' ? { reason: `included_${classification.reason}` } : {}),
  };
});

// Imports a statement. Idempotent and resumable: the import is keyed by the
// PDF's SHA-256, each notification is created at most once, and repeating a
// completed import changes nothing.
export const importKcbStatement = onCall({ timeoutSeconds: 540, memory: '1GiB' }, async (request) => {
  const actor = await requirePermission(request.auth, 'kcb.reconcile');
  const data = request.data as Data;
  const includeReceipts = receiptsToInclude(data.includeReceipts);
  const { bytes, statement, fileHash, problems } = await readStatement(data);
  if (problems.length) {
    throw new HttpsError(
      'failed-precondition',
      `The statement does not balance or is for another account: ${problems.map((item) => item.message).join(' ')}`,
    );
  }
  const importId = fileHash;
  const importRef = db().doc(`kcb_statement_imports/${importId}`);
  // Starts, or resumes, the import. Nothing is written for an officer whose
  // access changed after requirePermission.
  const started = await db().runTransaction(async (transaction) => {
    await reauthorizeActor(transaction, actor);
    const existing = await transaction.get(importRef);
    if (existing.get('status') === 'completed') return { completed: true, counts: existing.get('counts') ?? {} };
    if (!existing.exists) {
      transaction.create(importRef, validateDocumentWrite(kcbStatementImportDocumentSchema, {
        fileHash,
        fileName: fileNameValue(data.fileName),
        storagePath: statementPdfPath(fileHash),
        status: 'importing',
        ...headerSummary(statement),
        importedBy: actor.actorId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }, importRef.path));
    }
    return { completed: false, counts: {} };
  });
  if (started.completed) return { importId, duplicate: true, counts: started.counts };

  // Kept before any notification exists, so every imported payment has its
  // evidence. A resumed import stores it if an earlier attempt could not.
  await storeStatementPdf(fileHash, bytes, actor.actorId);

  const rows = await inChunks(statement.transactions, ROW_CONCURRENCY, (transaction) =>
    importRow(actor, transaction, importId, includeReceipts));
  const counts = rows.reduce<Record<string, number>>((total, row) => ({
    ...total, [row.outcome]: (total[row.outcome] ?? 0) + 1,
  }), {});

  await db().runTransaction(async (transaction) => {
    await reauthorizeActor(transaction, actor);
    const current = await transaction.get(importRef);
    if (current.get('status') === 'completed') return;
    transaction.update(importRef, {
      status: 'completed',
      counts,
      rows,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      completedBy: actor.actorId,
    });
    const auditPath = `audit_events/kcb-statement-imported-${importId}`;
    transaction.create(db().doc(auditPath), validateDocumentWrite(auditEventDocumentSchema, {
      requestId: `kcb-statement-imported-${importId}`,
      actorId: actor.actorId,
      actorRoles: actor.actorRoles,
      action: 'kcb_statement.imported',
      memberId: '',
      targetId: importId,
      changes: {
        periodStart: statement.header.periodStart,
        periodEnd: statement.header.periodEnd,
        transactionCount: statement.transactions.length,
        counts,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, auditPath));
  });
  return { importId, duplicate: false, counts };
});
