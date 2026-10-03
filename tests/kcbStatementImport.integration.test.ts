import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { statementPdf, type StatementHeader, type StatementRow } from './fixtures/kcbStatementPdf';

// Runs against the Firestore and Storage emulators (see `npm run test:integration`).
// Every test runs at least one full import: PDF parsing, Storage, and a
// transaction per row, which takes several seconds on CI runners.
vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 });
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
  await db().doc('kcb_payment_notifications/TD33CCCCCC').set(LIVE_NOTIFICATION);
  await db().doc('kcb_payment_notifications/FT25094DDDD4').set({ status: 'unresolved', source: 'till_notification' });
  // A code recorded against too little money.
  await db().doc('members/member-a/payments/manual-2').set({
    payment_id: 'manual-2', referencenumber: 'TD55EEEEEE', referenceNormalized: 'TD55EEEEEE', amount: 500,
  });
};

const LIVE_NOTIFICATION = {
  status: 'reconciled',
  source: 'till_notification',
  payerPhone: '+254700000003',
  payerName: 'CARL',
  amount: 1500,
  currency: 'KES',
  billReference: '7969138',
  transactionDate: 'Thu Apr 03 10:10:10 EAT 2025',
  matchReason: 'no_verified_phone_match',
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
    const preview = await call<{ problems: unknown[]; rows: PreviewRow[] }>(
      statement.previewKcbStatement, treasurer, { pdfBase64: pdfBase64() });

    expect(preview.problems).toEqual([]);
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
  type ImportResult = { importId: string; runId: string; duplicate: boolean; counts: Record<string, number> };
  const importPayments = (data: Record<string, unknown> = {}) =>
    call<ImportResult>(statement.importKcbStatement, treasurer, {
      requestId: 'run-1', pdfBase64: pdfBase64(), receipts: ['TD11AAAAAA', 'TD66FFFFFF'], ...data,
    });

  it('creates unresolved notifications for the selected payments only and keeps the PDF', async () => {
    const result = await importPayments({ receipts: ['TD11AAAAAA'], fileName: 'April 2025.pdf' });

    expect(result).toMatchObject({ runId: 'run-1', duplicate: false });
    expect(result.counts).toEqual({ imported: 1, already_in_app: 0, not_selected: 5, ignored: 2 });
    // TD66FFFFFF is new too, but was not selected.
    expect(await notificationIds()).toEqual(['FT25094DDDD4', 'TD11AAAAAA', 'TD33CCCCCC']);

    const imported = (await db().doc('kcb_payment_notifications/TD11AAAAAA').get()).data()!;
    expect(imported).toMatchObject({
      status: 'unresolved',
      source: 'statement_import',
      importId: result.importId,
      importRunId: 'run-1',
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
    // Existing notifications are left as they were.
    expect((await db().doc('kcb_payment_notifications/TD33CCCCCC').get()).data())
      .toEqual(LIVE_NOTIFICATION);

    const record = (await db().doc(`kcb_statement_imports/${result.importId}`).get()).data()!;
    expect(record).toMatchObject({
      fileName: 'April 2025.pdf',
      storagePath: `kcb_statements/${result.importId}.pdf`,
      accountNumber: '1100000001',
      periodStart: '2025-04-01',
      periodEnd: '2025-05-01',
      totalMoneyInCents: 600000,
      transactionCount: 8,
      importedBy: TREASURER,
      lastImportedBy: TREASURER,
    });
    const run = (await db().doc(`kcb_statement_imports/${result.importId}/runs/run-1`).get()).data()!;
    expect(run).toMatchObject({
      status: 'completed',
      receipts: ['TD11AAAAAA'],
      counts: result.counts,
      importedBy: TREASURER,
      rows: [{ index: 1, outcome: 'imported', receipt: 'TD11AAAAAA', notificationId: 'TD11AAAAAA' }],
    });
    // Payer details stay on the notifications.
    expect(JSON.stringify(run.rows)).not.toContain('2547');

    const [stored] = await admin.storage().bucket().file(record.storagePath).download();
    expect(stored.toString('base64')).toBe(pdfBase64());

    expect((await db().doc('audit_events/kcb-statement-imported-run-1').get()).data()).toMatchObject({
      action: 'kcb_statement.imported',
      actorId: TREASURER,
      actorRoles: ['treasurer'],
      targetId: result.importId,
      changes: { runId: 'run-1', selectedCount: 1, counts: result.counts, fromDate: null, toDate: null },
    });
  });

  it('returns the earlier result when the same run is repeated', async () => {
    const first = await importPayments();
    const ids = await notificationIds();
    await expect(importPayments()).resolves.toEqual({ ...first, duplicate: true });
    expect(await notificationIds()).toEqual(ids);
    await expect(importPayments({ receipts: ['TD11AAAAAA'] })).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'This requestId was already used for another selection.',
    });
  });

  it('imports the same statement again for another selection without duplicating payments', async () => {
    await importPayments({ requestId: 'june', receipts: ['TD11AAAAAA'] });
    const second = await importPayments({ requestId: 'july', receipts: ['TD11AAAAAA', 'TD66FFFFFF'] });

    expect(second.counts).toEqual({ imported: 2, already_in_app: 0, not_selected: 4, ignored: 2 });
    expect((await notificationIds()).filter((id) => id === 'TD11AAAAAA')).toHaveLength(1);
    expect((await db().doc('kcb_payment_notifications/TD11AAAAAA').get()).get('importRunId')).toBe('june');
    const runs = await db().collection(`kcb_statement_imports/${second.importId}/runs`).get();
    expect(runs.docs.map((doc) => doc.id).sort()).toEqual(['july', 'june']);
  });

  it('skips a selected payment that is already in the app', async () => {
    const result = await importPayments({ receipts: ['TD22BBBBBB', 'TD33CCCCCC', 'TD11AAAAAA'] });
    expect(result.counts).toEqual({ imported: 1, already_in_app: 2, not_selected: 3, ignored: 2 });
    const run = (await db().doc(`kcb_statement_imports/${result.importId}/runs/run-1`).get()).data()!;
    expect(run.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        receipt: 'TD22BBBBBB', outcome: 'already_in_app', reason: 'recorded_payment',
        matchedPaymentPaths: ['members/member-b/payments/manual-1'],
      }),
      expect.objectContaining({ receipt: 'TD33CCCCCC', outcome: 'already_in_app', reason: 'kcb_notification' }),
    ]));
  });

  it('never imports a payment twice from overlapping statements', async () => {
    await importPayments();
    // A later statement repeating the 6 April payment.
    const overlapping = await importPayments({
      requestId: 'run-2',
      receipts: ['TD66FFFFFF'],
      pdfBase64: pdfBase64(
        { ...HEADER, period: '06.04.2025 - 06.05.2025', start: '15,650.00', moneyIn: '300.00', moneyOut: '0.00' },
        [
          { date: '06.04.2025', details: ['BALANCE B/FWD'], out: '0.00', in: '0.00', balance: '15,650.00' },
          ROWS[7],
        ],
      ),
    });
    expect(overlapping.counts).toEqual({ imported: 0, already_in_app: 1, not_selected: 0, ignored: 1 });
    expect((await notificationIds()).filter((id) => id === 'TD66FFFFFF')).toHaveLength(1);
  });

  it('imports a payment that needs a check when the treasurer selects it', async () => {
    const result = await importPayments({ receipts: ['td55eeeeee'] });
    expect(result.counts).toMatchObject({ imported: 1 });
    expect((await db().doc('kcb_payment_notifications/TD55EEEEEE').get()).data()).toMatchObject({
      status: 'unresolved',
      source: 'statement_import',
      referenceCheck: { reason: 'amount_differs', matchedPaymentPaths: ['members/member-a/payments/manual-2'] },
    });
  });

  it('imports within a date range and records it', async () => {
    const result = await importPayments({ receipts: ['TD11AAAAAA'], fromDate: '2025-04-01', toDate: '2025-04-05' });
    expect((await db().doc(`kcb_statement_imports/${result.importId}/runs/run-1`).get()).data())
      .toMatchObject({ fromDate: '2025-04-01', toDate: '2025-04-05' });
    expect((await db().doc('audit_events/kcb-statement-imported-run-1').get()).get('changes'))
      .toMatchObject({ fromDate: '2025-04-01', toDate: '2025-04-05' });
  });

  it('completes an interrupted run without duplicating its notifications', async () => {
    const preview = await call<{ importId: string }>(statement.previewKcbStatement, treasurer, { pdfBase64: pdfBase64() });
    await db().doc(`kcb_statement_imports/${preview.importId}/runs/run-1`).set({
      requestId: 'run-1', importId: preview.importId, status: 'importing',
      receipts: ['TD11AAAAAA', 'TD66FFFFFF'], importedBy: TREASURER,
    });
    await db().doc('kcb_payment_notifications/TD11AAAAAA').set({
      status: 'unresolved', source: 'statement_import', importId: preview.importId,
    });

    const result = await importPayments();
    expect(result.counts).toEqual({ imported: 2, already_in_app: 0, not_selected: 4, ignored: 2 });
    expect((await db().doc(`kcb_statement_imports/${preview.importId}/runs/run-1`).get()).get('status'))
      .toBe('completed');
  });

  it('refuses a statement that does not balance, writing nothing', async () => {
    const tampered = ROWS.map((row) => (row.reference === 'FT25092AAAA1' ? { ...row, in: '1,100.00' } : row));
    await expect(importPayments({ pdfBase64: pdfBase64(HEADER, tampered) }))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect(await notificationIds()).toEqual(['FT25094DDDD4', 'TD33CCCCCC']);
    expect((await db().collection('kcb_statement_imports').get()).empty).toBe(true);
    expect((await admin.storage().bucket().getFiles())[0]).toEqual([]);
  });

  it('rejects selections that are empty, not in the statement or outside the range', async () => {
    const rejected = async (data: Record<string, unknown>, message: string) =>
      expect(importPayments(data)).rejects.toMatchObject({ code: 'invalid-argument', message });
    await rejected({ receipts: [] }, 'Choose at least one payment to import.');
    await rejected({ receipts: ['BALANCE B/F'] }, 'receipts must be M-Pesa receipts.');
    await rejected({ receipts: ['TD99ZZZZZZ'] }, 'TD99ZZZZZZ is not an M-Pesa payment in this statement.');
    await rejected(
      { receipts: ['TD66FFFFFF'], fromDate: '2025-04-01', toDate: '2025-04-05' },
      'TD66FFFFFF is outside the chosen date range.',
    );
    await rejected({ fromDate: '2025-04-30', toDate: '2025-04-01' }, 'fromDate must not be after toDate.');
    await rejected({ requestId: '' }, 'requestId is required.');
    expect((await db().collection('kcb_statement_imports').get()).empty).toBe(true);
  });
});

describe('already recorded statement payments', () => {
  const mark = (data: Record<string, unknown>) =>
    call(statement.markKcbPaymentAlreadyRecorded, treasurer, {
      requestId: 'mark-1',
      providerTransactionId: 'TD11AAAAAA',
      memberId: 'member-a',
      paymentIds: ['manual-3'],
      contributionIds: ['2025-04-01'],
      reason: 'Paid in cash to the treasurer and recorded by hand',
      ...data,
    });
  const undo = (data: Record<string, unknown> = {}) =>
    call(statement.undoKcbPaymentAlreadyRecorded, treasurer, {
      requestId: 'undo-1', providerTransactionId: 'TD11AAAAAA', reason: 'Linked to the wrong payment', ...data,
    });
  const snapshotOf = async () => ({
    member: (await db().doc('members/member-a').get()).data(),
    contribution: (await db().doc('members/member-a/contributions/2025-04-01').get()).data(),
    payments: (await db().collection('members/member-a/payments').get()).docs.map((doc) => doc.data()),
    stats: (await db().collection('monthly_stats').get()).docs.map((doc) => doc.data()),
  });

  beforeEach(async () => {
    await db().doc('members/member-a').set({ balance: 0, contributionBalance: 1000 }, { merge: true });
    // Recorded by hand without the M-Pesa code, so the import could not match it.
    await db().doc('members/member-a/payments/manual-3').set({
      payment_id: 'manual-3', referencenumber: 'cash', amount: 1000,
    });
    await db().doc('members/member-a/contributions/2025-04-01').set({
      contribution_id: '2025-04-01', month: '2025-04-01', amount: 1000, balance: 0, paid: 'paid',
    });
    await db().doc('members/member-a/contributions/2025-05-01').set({
      contribution_id: '2025-05-01', month: '2025-05-01', amount: 1000, balance: 1000, paid: 'unpaid',
    });
    await call(statement.importKcbStatement, treasurer, {
      requestId: 'run-1', pdfBase64: pdfBase64(), receipts: ['TD11AAAAAA', 'TD66FFFFFF'],
    });
  });

  it('links the payment to existing records without changing any balance', async () => {
    const before = await snapshotOf();
    await expect(mark({})).resolves.toEqual({ requestId: 'mark-1', duplicate: false });

    expect(await snapshotOf()).toEqual(before);
    expect((await db().doc('kcb_payment_notifications/TD11AAAAAA').get()).data()).toMatchObject({
      status: 'already_recorded',
      memberId: 'member-a',
      linkedPaymentIds: ['manual-3'],
      linkedContributionIds: ['2025-04-01'],
      alreadyRecordedReason: 'Paid in cash to the treasurer and recorded by hand',
      alreadyRecordedBy: TREASURER,
    });
    expect((await db().doc('kcb_legacy_payment_links/member-a_manual-3').get()).data())
      .toMatchObject({ providerTransactionId: 'TD11AAAAAA', linkedBy: TREASURER });
    expect((await db().doc('audit_events/mark-1').get()).data()).toMatchObject({
      action: 'payment.already_recorded', memberId: 'member-a', targetId: 'TD11AAAAAA',
      changes: { amount: 1000, linkedPaymentIds: ['manual-3'], linkedContributionIds: ['2025-04-01'] },
    });
    await expect(mark({})).resolves.toEqual({ requestId: 'mark-1', duplicate: true });
  });

  it('never lets one existing payment account for two statement payments', async () => {
    await mark({});
    await expect(mark({ requestId: 'mark-2', providerTransactionId: 'TD66FFFFFF' })).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'That payment already accounts for statement payment TD11AAAAAA.',
    });
  });

  it('refuses links that cannot account for the payment', async () => {
    await expect(mark({ paymentIds: [], contributionIds: [] })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(mark({ paymentIds: ['missing'] })).rejects.toMatchObject({ code: 'not-found' });
    await expect(mark({ paymentIds: [], contributionIds: ['2025-05-01'] }))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(mark({ paymentIds: ['manual-1'], contributionIds: [] })).rejects.toMatchObject({ code: 'not-found' });
    await expect(mark({ memberId: TREASURER })).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await db().doc('kcb_payment_notifications/TD11AAAAAA').get()).get('status')).toBe('unresolved');
  });

  it('applies only to unresolved payments imported from a statement', async () => {
    await expect(mark({ providerTransactionId: 'TD33CCCCCC' })).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'Only payments imported from a statement can be marked already recorded.',
    });
    await mark({});
    await expect(mark({ requestId: 'mark-2' })).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'Only unresolved payments can be marked already recorded.',
    });
  });

  it('can be undone, returning the payment to the queue unlocked', async () => {
    await mark({});
    const before = await snapshotOf();
    await expect(undo()).resolves.toEqual({ requestId: 'undo-1', duplicate: false });

    expect(await snapshotOf()).toEqual(before);
    const notification = (await db().doc('kcb_payment_notifications/TD11AAAAAA').get()).data()!;
    expect(notification).toMatchObject({ status: 'unresolved', source: 'statement_import' });
    for (const field of ['memberId', 'linkedPaymentIds', 'linkedContributionIds', 'alreadyRecordedReason']) {
      expect(notification).not.toHaveProperty(field);
    }
    expect(notification.alreadyRecordedHistory).toEqual([expect.objectContaining({
      requestId: 'undo-1', memberId: 'member-a', linkedPaymentIds: ['manual-3'],
      undoneReason: 'Linked to the wrong payment', undoneBy: TREASURER,
    })]);
    expect((await db().doc('kcb_legacy_payment_links/member-a_manual-3').get()).exists).toBe(false);
    expect((await db().doc('audit_events/undo-1').get()).get('action')).toBe('payment.already_recorded_undone');
    await expect(undo()).resolves.toEqual({ requestId: 'undo-1', duplicate: true });

    // The freed payment can now account for another statement payment.
    await expect(mark({ requestId: 'mark-2', providerTransactionId: 'TD66FFFFFF' })).resolves.toMatchObject({
      duplicate: false,
    });
    await expect(undo({ requestId: 'undo-2' })).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});
