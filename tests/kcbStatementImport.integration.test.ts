import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { statementPdf, type StatementHeader, type StatementRow } from './fixtures/kcbStatementPdf';

// Runs against the Firestore and Storage emulators (see `npm run test:integration`).
process.env.GCLOUD_PROJECT = 'demo-tmbwa';
process.env.KCB_STATEMENT_ACCOUNT_NUMBER = '1100000001';

const { admin } = await import('../functions/src/firebaseAdmin');
admin.initializeApp({ projectId: 'demo-tmbwa', storageBucket: 'demo-tmbwa.appspot.com' });
const statement = await import('../functions/src/kcb/statement');

const db = () => admin.firestore();
const TREASURER = 'officer-1';
const treasurer = { uid: TREASURER, token: { roles: ['treasurer'] } };

type Callable = { run: (request: never) => Promise<unknown> };
const call = <Result = Record<string, unknown>>(fn: unknown, auth: unknown, data: Record<string, unknown>) =>
  (fn as Callable).run({ auth, data, rawRequest: {} } as never) as Promise<Result>;

const HEADER: StatementHeader = {
  account: '1100000001',
  period: '01.04.2025 - 01.05.2025',
  start: '10,000.00',
  end: '15,950.00',
  moneyIn: '6,000.00',
  moneyOut: '50.00',
};

const mpesa = (date: string, receipt: string, phone: string, name: string, amount: string, balance: string,
  reference: string): StatementRow => ({
  date, details: ['Transfer 7969138 MPESA', `${receipt} ${phone} ${name} /`],
  out: '0.00', in: amount, balance, reference,
});

// One row per outcome; see the seeded data below.
const ROWS: StatementRow[] = [
  { date: '01.04.2025', details: ['BALANCE B/FWD'], out: '0.00', in: '0.00', balance: '10,000.00' },
  mpesa('02.04.2025', 'TD11AAAAAA', '254700000001', 'ALIC', '1,000.00', '11,000.00', 'FT25092AAAA1'),
  mpesa('02.04.2025', 'TD22BBBBBB', '254700000002', 'BOB', '500.00', '11,500.00', 'FT25092BBBB2'),
  mpesa('03.04.2025', 'TD33CCCCCC', '254700000003', 'CARL', '1,500.00', '13,000.00', 'FT25093CCCC3'),
  mpesa('04.04.2025', 'TD44DDDDDD', '254700000004', 'DAN', '700.00', '13,700.00', 'FT25094DDDD4'),
  mpesa('05.04.2025', 'TD55EEEEEE', '254700000001', 'ALIC', '2,000.00', '15,700.00', 'FT25095EEEE5'),
  { date: '05.04.2025', details: ['Excise Duty'], out: '50.00', in: '0.00', balance: '15,650.00', reference: 'FT25095FFFF6' },
  mpesa('06.04.2025', 'TD66FFFFFF', '254799999999', 'Zed', '300.00', '15,950.00', 'FT25096GGGG7'),
];

const pdfBase64 = (header: StatementHeader = HEADER, rows: StatementRow[] = ROWS) =>
  statementPdf(header, rows).toString('base64');

const clearFirestore = () =>
  fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-tmbwa/databases/(default)/documents`,
    { method: 'DELETE' },
  );
const clearStorage = async () => {
  const [files] = await admin.storage().bucket().getFiles();
  await Promise.all(files.map((file) => file.delete()));
};

const seed = async () => {
  await db().doc(`members/${TREASURER}`).set({ status: 'active', roles: ['member', 'treasurer'] });
  await db().doc('members/member-a').set({ status: 'active', firstname: 'Alice', phoneNormalized: '+254700000001' });
  await db().doc('members/member-b').set({ status: 'active', firstname: 'Bob', phoneNormalized: '+254700000002' });
  // Recorded by hand with the M-Pesa code, typed in lower case.
  await db().doc('members/member-b/payments/manual-1').set({
    payment_id: 'manual-1', referencenumber: 'td22bbbbbb', referenceNormalized: 'TD22BBBBBB', amount: 500,
  });
  // A live notification keyed by receipt, and one stored before #86 keyed by FT reference.
  await db().doc('kcb_payment_notifications/TD33CCCCCC').set({ status: 'reconciled', source: 'till_notification' });
  await db().doc('kcb_payment_notifications/FT25094DDDD4').set({ status: 'unresolved', source: 'till_notification' });
  // A code recorded against too little money.
  await db().doc('members/member-a/payments/manual-2').set({
    payment_id: 'manual-2', referencenumber: 'TD55EEEEEE', referenceNormalized: 'TD55EEEEEE', amount: 500,
  });
};

const notificationIds = async () =>
  (await db().collection('kcb_payment_notifications').get()).docs.map((doc) => doc.id).sort();

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
    throw new Error('Run with the Firestore and Storage emulators: npm run test:integration');
  }
});

beforeEach(async () => {
  process.env.KCB_STATEMENT_ACCOUNT_NUMBER = '1100000001';
  await clearFirestore();
  await clearStorage();
  await seed();
});

afterAll(async () => {
  await clearFirestore();
  await clearStorage();
});

type PreviewRow = { index: number; outcome: string; reason?: string; suggestedMemberId?: string };

describe('previewKcbStatement', () => {
  it('reports what an import would do with each row, without writing anything', async () => {
    const before = await notificationIds();
    const preview = await call<{ importStatus: unknown; problems: unknown[]; rows: PreviewRow[] }>(
      statement.previewKcbStatement, treasurer, { pdfBase64: pdfBase64() });

    expect(preview.problems).toEqual([]);
    expect(preview.importStatus).toBeNull();
    expect(preview.rows.map(({ index, outcome, reason }) => ({ index, outcome, reason }))).toEqual([
      { index: 0, outcome: 'ignored', reason: 'opening_balance' },
      { index: 1, outcome: 'new', reason: undefined },
      { index: 2, outcome: 'already_in_app', reason: 'recorded_payment' },
      { index: 3, outcome: 'already_in_app', reason: 'kcb_notification' },
      { index: 4, outcome: 'already_in_app', reason: 'kcb_notification' },
      { index: 5, outcome: 'matched_check', reason: 'amount_differs' },
      { index: 6, outcome: 'ignored', reason: 'not_mpesa_credit' },
      { index: 7, outcome: 'new', reason: undefined },
    ]);
    expect(preview.rows[1].suggestedMemberId).toBe('member-a');
    expect(preview.rows[7].suggestedMemberId).toBeUndefined();
    expect(await notificationIds()).toEqual(before);
    expect((await db().collection('kcb_statement_imports').get()).empty).toBe(true);
  });

  it('reports problems and no rows for a statement of another account', async () => {
    const preview = await call<{ problems: Array<{ code: string }>; rows: unknown[] }>(
      statement.previewKcbStatement, treasurer, { pdfBase64: pdfBase64({ ...HEADER, account: '1100000002' }) });
    expect(preview.problems.map((problem) => problem.code)).toEqual(['account_mismatch']);
    expect(preview.rows).toEqual([]);
  });

  it('refuses files that are not KCB statements', async () => {
    await expect(call(statement.previewKcbStatement, treasurer, {
      pdfBase64: Buffer.from('%PDF-1.4 broken').toString('base64'),
    })).rejects.toMatchObject({ code: 'invalid-argument', message: 'The PDF could not be read.' });
    await expect(call(statement.previewKcbStatement, treasurer, {
      pdfBase64: Buffer.from('plain text').toString('base64'),
    })).rejects.toMatchObject({ code: 'invalid-argument', message: 'The file is not a PDF.' });
  });

  it('is refused until the association account number is configured', async () => {
    process.env.KCB_STATEMENT_ACCOUNT_NUMBER = '';
    await expect(call(statement.previewKcbStatement, treasurer, { pdfBase64: pdfBase64() }))
      .rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

describe('importKcbStatement', () => {
  it('creates unresolved notifications for new payments only and keeps the PDF', async () => {
    const result = await call<{ importId: string; duplicate: boolean; counts: Record<string, number> }>(
      statement.importKcbStatement, treasurer, { pdfBase64: pdfBase64(), fileName: 'April 2025.pdf' });

    expect(result.duplicate).toBe(false);
    expect(result.counts).toEqual({ ignored: 2, imported: 2, already_in_app: 3, matched_check: 1 });
    expect(await notificationIds()).toEqual(['FT25094DDDD4', 'TD11AAAAAA', 'TD33CCCCCC', 'TD66FFFFFF']);

    const imported = (await db().doc('kcb_payment_notifications/TD11AAAAAA').get()).data()!;
    expect(imported).toMatchObject({
      status: 'unresolved',
      source: 'statement_import',
      importId: result.importId,
      importedBy: TREASURER,
      providerTransactionId: 'TD11AAAAAA',
      mpesaReceiptNumber: 'TD11AAAAAA',
      kcbTransactionReference: 'FT25092AAAA1',
      payerPhone: '+254700000001',
      payerName: 'ALIC',
      amount: 1000,
      currency: 'KES',
      billReference: '7969138',
      transactionDate: '20250402000000',
      statementDate: '2025-04-02',
      suggestedMemberId: 'member-a',
      matchReason: 'unique_profile_phone',
    });
    expect(imported.paidAt.toDate().toISOString()).toBe('2025-04-01T21:00:00.000Z');
    expect((await db().doc('kcb_payment_notifications/TD66FFFFFF').get()).data()).toMatchObject({
      suggestedMemberId: null,
      matchReason: 'no_verified_phone_match',
    });
    // Existing notifications are left as they were.
    expect((await db().doc('kcb_payment_notifications/TD33CCCCCC').get()).data())
      .toEqual({ status: 'reconciled', source: 'till_notification' });

    const record = (await db().doc(`kcb_statement_imports/${result.importId}`).get()).data()!;
    expect(record).toMatchObject({
      status: 'completed',
      fileName: 'April 2025.pdf',
      storagePath: `kcb_statements/${result.importId}.pdf`,
      accountNumber: '1100000001',
      periodStart: '2025-04-01',
      periodEnd: '2025-05-01',
      totalMoneyInCents: 600000,
      transactionCount: 8,
      importedBy: TREASURER,
      completedBy: TREASURER,
    });
    expect(record.rows[2]).toMatchObject({
      outcome: 'already_in_app', reason: 'recorded_payment', receipt: 'TD22BBBBBB',
      matchedPaymentPaths: ['members/member-b/payments/manual-1'],
    });
    expect(record.rows[5]).toMatchObject({ outcome: 'matched_check', reason: 'amount_differs' });
    // Payer details stay on the notifications.
    expect(JSON.stringify(record.rows)).not.toContain('2547');

    const [stored] = await admin.storage().bucket().file(record.storagePath).download();
    expect(stored.toString('base64')).toBe(pdfBase64());

    expect((await db().doc(`audit_events/kcb-statement-imported-${result.importId}`).get()).data()).toMatchObject({
      action: 'kcb_statement.imported',
      actorId: TREASURER,
      actorRoles: ['treasurer'],
      targetId: result.importId,
      changes: { counts: result.counts, transactionCount: 8 },
    });
  });

  it('changes nothing when the same statement is imported again', async () => {
    const first = await call<{ importId: string }>(statement.importKcbStatement, treasurer, { pdfBase64: pdfBase64() });
    const ids = await notificationIds();
    const again = await call<{ importId: string; duplicate: boolean }>(
      statement.importKcbStatement, treasurer, { pdfBase64: pdfBase64() });
    expect(again).toMatchObject({ importId: first.importId, duplicate: true });
    expect(await notificationIds()).toEqual(ids);
  });

  it('never imports a payment twice from overlapping statements', async () => {
    await call(statement.importKcbStatement, treasurer, { pdfBase64: pdfBase64() });
    // A later statement repeating the 6 April payment.
    const overlapping = await call<{ counts: Record<string, number> }>(statement.importKcbStatement, treasurer, {
      pdfBase64: pdfBase64(
        { ...HEADER, period: '06.04.2025 - 06.05.2025', start: '15,650.00', moneyIn: '300.00', moneyOut: '0.00' },
        [
          { date: '06.04.2025', details: ['BALANCE B/FWD'], out: '0.00', in: '0.00', balance: '15,650.00' },
          ROWS[7],
        ],
      ),
    });
    expect(overlapping.counts).toEqual({ ignored: 1, already_in_app: 1 });
    expect((await notificationIds()).filter((id) => id === 'TD66FFFFFF')).toHaveLength(1);
  });

  it('imports a payment that needs a check only when the treasurer includes it', async () => {
    const result = await call<{ counts: Record<string, number> }>(statement.importKcbStatement, treasurer, {
      pdfBase64: pdfBase64(), includeReceipts: ['td55eeeeee'],
    });
    expect(result.counts).toEqual({ ignored: 2, imported: 3, already_in_app: 3 });
    expect((await db().doc('kcb_payment_notifications/TD55EEEEEE').get()).data()).toMatchObject({
      status: 'unresolved',
      source: 'statement_import',
      referenceCheck: { reason: 'amount_differs', matchedPaymentPaths: ['members/member-a/payments/manual-2'] },
    });
  });

  it('completes an interrupted import without duplicating its notifications', async () => {
    const preview = await call<{ importId: string }>(statement.previewKcbStatement, treasurer, { pdfBase64: pdfBase64() });
    await db().doc(`kcb_statement_imports/${preview.importId}`).set({ status: 'importing' });
    await db().doc('kcb_payment_notifications/TD11AAAAAA').set({
      status: 'unresolved', source: 'statement_import', importId: preview.importId,
    });

    const result = await call<{ counts: Record<string, number> }>(
      statement.importKcbStatement, treasurer, { pdfBase64: pdfBase64() });
    expect(result.counts).toEqual({ ignored: 2, imported: 2, already_in_app: 3, matched_check: 1 });
    expect((await db().doc(`kcb_statement_imports/${preview.importId}`).get()).get('status')).toBe('completed');
  });

  it('refuses a statement that does not balance, writing nothing', async () => {
    const tampered = ROWS.map((row) => (row.reference === 'FT25092AAAA1' ? { ...row, in: '1,100.00' } : row));
    await expect(call(statement.importKcbStatement, treasurer, { pdfBase64: pdfBase64(HEADER, tampered) }))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect(await notificationIds()).toEqual(['FT25094DDDD4', 'TD33CCCCCC']);
    expect((await db().collection('kcb_statement_imports').get()).empty).toBe(true);
    expect((await admin.storage().bucket().getFiles())[0]).toEqual([]);
  });

  it('rejects an invalid list of receipts to include', async () => {
    await expect(call(statement.importKcbStatement, treasurer, { pdfBase64: pdfBase64(), includeReceipts: ['BALANCE B/F'] }))
      .rejects.toMatchObject({ code: 'invalid-argument' });
  });
});
