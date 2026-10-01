import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Runs against the Firestore emulator only (see `npm run test:integration`).
process.env.GCLOUD_PROJECT = 'demo-tmbwa';

const { admin } = await import('../functions/src/firebaseAdmin');
admin.initializeApp({ projectId: 'demo-tmbwa' });
const members = await import('../functions/src/members');
const financial = await import('../functions/src/financial');

const db = () => admin.firestore();
const SUPER = 'super-1';
const OTHER_SUPER = 'super-2';
const TARGET = 'member-target';

// Firebase Auth is not emulated: record what the commands ask of it.
const authCalls = {
  setCustomUserClaims: vi.fn(async () => undefined),
  revokeRefreshTokens: vi.fn(async () => undefined),
  createUser: vi.fn(async () => undefined),
};
vi.spyOn(admin, 'auth').mockImplementation(() => authCalls as never);

type Callable = { run: (request: never) => Promise<Record<string, unknown>> };
const call = (fn: unknown, auth: unknown, data: Record<string, unknown>) =>
  (fn as Callable).run({ auth, data, rawRequest: {} } as never);

const superAuth = (uid = SUPER) => ({ uid, token: { roles: ['super_admin'] } });

let sequence = 0;
const nextRequestId = () => `role-request-${String(++sequence).padStart(4, '0')}`;

const assign = (
  data: Record<string, unknown>,
  auth: unknown = superAuth(),
) =>
  call(members.assignMemberRoles, auth, {
    requestId: nextRequestId(),
    memberId: TARGET,
    reason: 'Elected at the annual general meeting',
    ...data,
  });

const memberFields = (overrides: Record<string, unknown> = {}) => ({
  firstname: 'Synthetic',
  lastname: 'Member',
  membernumber: '0001/26',
  win: 'WIN-1',
  phonenumber: '+254712345678',
  gender: 'female',
  email: 'synthetic@example.test',
  role: 'member',
  isFeesPaid: true,
  status: 'active',
  balance: 0,
  contributionBalance: 0,
  ...overrides,
});

const seed = async () => {
  await db().doc(`members/${SUPER}`).set({ status: 'active', roles: ['member', 'super_admin'] });
  await db().doc(`members/${OTHER_SUPER}`).set({ status: 'active', roles: ['member', 'super_admin'] });
  await db().doc(`members/${TARGET}`).set(memberFields());
};

const memberDoc = async (id = TARGET) => (await db().doc(`members/${id}`).get()).data()!;
const auditEvents = async () =>
  (await db().collection('audit_events').get()).docs.map((doc) => doc.data());

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
  await clearFirestore();
  Object.values(authCalls).forEach((fn) => fn.mockClear());
  await seed();
});

afterAll(async () => {
  vi.restoreAllMocks();
  await clearFirestore();
});

describe('assignMemberRoles', () => {
  it('grants roles, mirrors them in claims and ends existing sessions', async () => {
    const result = await assign({ roles: ['registrar', 'welfare_officer'] });

    expect(result).toMatchObject({
      memberId: TARGET,
      previousRoles: ['member'],
      roles: ['member', 'registrar', 'welfare_officer'],
      duplicate: false,
    });
    expect(await memberDoc()).toMatchObject({
      roles: ['member', 'registrar', 'welfare_officer'],
      rolesUpdatedBy: SUPER,
    });
    expect(authCalls.setCustomUserClaims).toHaveBeenCalledWith(TARGET, {
      roles: ['member', 'registrar', 'welfare_officer'],
    });
    expect(authCalls.revokeRefreshTokens).toHaveBeenCalledWith(TARGET);
  });

  it('writes one audit event and an assignment record with the reason', async () => {
    const result = await assign({ roles: ['treasurer'] });
    const events = await auditEvents();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      requestId: result.requestId,
      actorId: SUPER,
      actorRoles: ['super_admin'],
      action: 'role.granted',
      memberId: TARGET,
      targetId: TARGET,
      changes: {
        previousRoles: ['member'],
        roles: ['member', 'treasurer'],
        granted: ['treasurer'],
        revoked: [],
        reason: 'Elected at the annual general meeting',
      },
    });
    expect((await db().doc(`role_assignments/${result.requestId}`).get()).data()).toMatchObject({
      memberId: TARGET,
      actorId: SUPER,
      previousRoles: ['member'],
      roles: ['member', 'treasurer'],
      reason: 'Elected at the annual general meeting',
    });
  });

  it('no longer writes the retired role field or claim', async () => {
    await assign({ roles: ['super_admin'] });
    // The fixture's retired `role` field is left exactly as it was.
    expect((await memberDoc()).role).toBe('member');
    expect(authCalls.setCustomUserClaims).toHaveBeenLastCalledWith(TARGET, {
      roles: ['member', 'super_admin'],
    });

    await assign({ roles: [] });
    expect(await memberDoc()).toMatchObject({ roles: ['member'] });
    expect((await auditEvents()).map((event) => event.action).sort()).toEqual(['role.granted', 'role.revoked']);
  });

  it('records a mixed change as role.changed', async () => {
    await assign({ roles: ['auditor'] });
    await assign({ roles: ['treasurer'] });
    const changed = (await auditEvents()).find((event) => event.action === 'role.changed');
    expect(changed?.changes).toMatchObject({ granted: ['treasurer'], revoked: ['auditor'] });
  });

  it('is idempotent on requestId', async () => {
    const data = { requestId: 'role-request-retry', roles: ['auditor'] };
    const first = await assign(data);
    const retry = await assign(data);

    expect(first.duplicate).toBe(false);
    expect(retry).toMatchObject({ duplicate: true, roles: ['member', 'auditor'] });
    expect(await auditEvents()).toHaveLength(1);
    // A retry repairs claims but does not end the member's sessions again.
    expect(authCalls.setCustomUserClaims).toHaveBeenCalledTimes(2);
    expect(authCalls.revokeRefreshTokens).toHaveBeenCalledTimes(1);
  });

  it('refuses a requestId already used for another member', async () => {
    await db().doc('members/member-other').set(memberFields({ email: 'other@example.test' }));
    await assign({ requestId: 'role-request-shared', roles: ['auditor'] });
    await expect(
      assign({ requestId: 'role-request-shared', memberId: 'member-other', roles: ['auditor'] }),
    ).rejects.toMatchObject({ code: 'already-exists' });
  });

  it('refuses changes to the actor\'s own roles', async () => {
    await expect(assign({ memberId: SUPER, roles: [] })).rejects.toMatchObject({
      code: 'permission-denied',
      message: 'You cannot change your own roles. Another super admin must do it.',
    });
    expect((await memberDoc(SUPER)).roles).toEqual(['member', 'super_admin']);
  });

  it('is limited to super admins', async () => {
    await db().doc('members/treasurer-1').set({ status: 'active', roles: ['member', 'treasurer'] });
    const treasurer = { uid: 'treasurer-1', token: { roles: ['treasurer'] } };
    await expect(assign({ roles: ['treasurer'] }, treasurer)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(
      call(members.assignMemberRoles, undefined, {
        requestId: nextRequestId(),
        memberId: TARGET,
        roles: ['treasurer'],
        reason: 'No sign in',
      }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect((await memberDoc()).roles).toBeUndefined();
  });

  it('honours a super admin revocation before the old token expires', async () => {
    // super-1 still holds a super_admin token, but the record no longer agrees.
    await db().doc(`members/${SUPER}`).update({ roles: ['member'] });
    await expect(assign({ roles: ['treasurer'] })).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it.each([
    [{ roles: ['owner'] }, 'invalid-argument'],
    [{ roles: 'treasurer' }, 'invalid-argument'],
    [{ reason: '  ' }, 'invalid-argument'],
    [{ reason: 'x'.repeat(501) }, 'invalid-argument'],
    [{ requestId: 'short' }, 'invalid-argument'],
    [{ roles: [] }, 'failed-precondition'],
    [{ memberId: 'missing-member', roles: ['auditor'] }, 'not-found'],
  ])('rejects %j with %s', async (data, code) => {
    await expect(assign({ roles: ['auditor'], ...data })).rejects.toMatchObject({ code });
    expect(await auditEvents()).toEqual([]);
  });

  it('grants roles only to active members but can always revoke them', async () => {
    await db().doc(`members/${TARGET}`).update({ status: 'suspended', roles: ['member', 'treasurer'] });
    await expect(assign({ roles: ['treasurer', 'auditor'] })).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'Only active members can be granted roles.',
    });
    await expect(assign({ roles: [] })).resolves.toMatchObject({ roles: ['member'] });
  });

  it('treats a record carrying only the retired administrator role as a plain member', async () => {
    await db().doc(`members/${TARGET}`).update({ role: 'administrator' });
    await expect(assign({ roles: ['treasurer'] })).resolves.toMatchObject({
      previousRoles: ['member'],
      roles: ['member', 'treasurer'],
    });
  });

  it('never leaves the association without a super admin', async () => {
    // Two super admins remove each other at the same moment: one must lose.
    const results = await Promise.allSettled([
      assign({ memberId: OTHER_SUPER, roles: [] }, superAuth(SUPER)),
      assign({ memberId: SUPER, roles: [] }, superAuth(OTHER_SUPER)),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const remaining = [await memberDoc(SUPER), await memberDoc(OTHER_SUPER)].filter((member) =>
      (member.roles as string[]).includes('super_admin'),
    );
    expect(remaining).toHaveLength(1);
    // Contending transactions back off and retry in the emulator.
  }, 20_000);

  it('makes a revoked role stop working immediately', async () => {
    await assign({ roles: ['treasurer'] });
    await db().doc(`members/${TARGET}/contributions/2026-09-01`).set({ amount: 500 });
    await assign({ roles: [] });
    // The target's token still claims treasurer until it expires.
    const staleToken = { uid: TARGET, token: { role: 'member', roles: ['treasurer'] } };
    await expect(
      call(financial.listLegacyContributionInventory, staleToken, {}),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('assignMemberRoles Auth side effects', () => {
  const assignment = async (requestId: string) =>
    (await db().doc(`role_assignments/${requestId}`).get()).data()!;
  const data = { requestId: 'role-request-partial', roles: ['treasurer'] };

  it('finishes claims and session revocation on retry after claims fail', async () => {
    authCalls.setCustomUserClaims.mockRejectedValueOnce(new Error('auth unavailable'));
    await expect(assign(data)).rejects.toThrow('auth unavailable');
    // The assignment committed, but nothing in Auth happened yet.
    expect((await memberDoc()).roles).toEqual(['member', 'treasurer']);
    expect(authCalls.revokeRefreshTokens).not.toHaveBeenCalled();
    expect((await assignment(data.requestId)).sessionsRevokedAt).toBeUndefined();

    await expect(assign(data)).resolves.toMatchObject({ duplicate: true });
    expect(authCalls.setCustomUserClaims).toHaveBeenLastCalledWith(TARGET, {
      roles: ['member', 'treasurer'],
    });
    expect(authCalls.revokeRefreshTokens).toHaveBeenCalledTimes(1);
    expect((await assignment(data.requestId)).sessionsRevokedAt).toBeDefined();
    expect(await auditEvents()).toHaveLength(1);
  });

  it('retries session revocation until it succeeds, then stops', async () => {
    authCalls.revokeRefreshTokens.mockRejectedValueOnce(new Error('auth unavailable'));
    await expect(assign(data)).rejects.toThrow('auth unavailable');
    expect((await assignment(data.requestId)).sessionsRevokedAt).toBeUndefined();

    await assign(data);
    expect(authCalls.revokeRefreshTokens).toHaveBeenCalledTimes(2);
    expect((await assignment(data.requestId)).sessionsRevokedAt).toBeDefined();

    await assign(data);
    expect(authCalls.revokeRefreshTokens).toHaveBeenCalledTimes(2);
  });

  it('never leaves claims at an assignment that a newer one replaced', async () => {
    // While the first command writes claims, a second assignment commits.
    authCalls.setCustomUserClaims.mockImplementationOnce(async () => {
      await db().doc(`members/${TARGET}`).update({ roles: ['member', 'auditor'] });
    });
    await assign({ roles: ['treasurer'] });
    expect(authCalls.setCustomUserClaims).toHaveBeenLastCalledWith(TARGET, {
      roles: ['member', 'auditor'],
    });
  });

  // Contending transactions back off and retry in the emulator, so this takes
  // a few seconds; the interleaving itself is covered deterministically above.
  it('leaves claims matching the record after concurrent assignments', async () => {
    await Promise.allSettled([
      assign({ roles: ['treasurer'] }),
      assign({ roles: ['auditor'] }),
    ]);
    const finalRoles = (await memberDoc()).roles;
    expect(authCalls.setCustomUserClaims).toHaveBeenLastCalledWith(TARGET, {
      roles: finalRoles,
    });
  }, 20_000);
});

describe('member role triggers', () => {
  type Trigger = { run: (event: never) => Promise<unknown> };
  const runUpdate = async (fields: Record<string, unknown>, id = TARGET) => {
    const ref = db().doc(`members/${id}`);
    const before = await ref.get();
    await ref.update(fields);
    const after = await ref.get();
    await (members.updateMember as unknown as Trigger).run({
      data: { before, after },
      params: { memberId: id },
    } as never);
  };

  it('leaves claims alone when backfilling roles for a plain member', async () => {
    await runUpdate({ roles: ['member'] });
    expect(authCalls.setCustomUserClaims).not.toHaveBeenCalled();
  });

  it('applies the latest roles even when events arrive out of order', async () => {
    const ref = db().doc(`members/${TARGET}`);
    await ref.update({ roles: ['member', 'auditor'] });
    const auditor = await ref.get();
    await ref.update({ roles: ['member', 'treasurer'] });
    const treasurer = await ref.get();
    await ref.update({ roles: ['member', 'auditor'] });
    const auditorAgain = await ref.get();
    const trigger = members.updateMember as unknown as Trigger;
    // The later change's event runs first, then the earlier one.
    await trigger.run({ data: { before: treasurer, after: auditorAgain }, params: { memberId: TARGET } } as never);
    await trigger.run({ data: { before: auditor, after: treasurer }, params: { memberId: TARGET } } as never);
    expect(authCalls.setCustomUserClaims).toHaveBeenLastCalledWith(TARGET, {
      roles: ['member', 'auditor'],
    });
  });

  it('repairs claims when the effective roles change', async () => {
    await runUpdate({ roles: ['member', 'auditor'] });
    expect(authCalls.setCustomUserClaims).toHaveBeenCalledWith(TARGET, {
      roles: ['member', 'auditor'],
    });
  });

  it('starts new members as plain members', async () => {
    const ref = db().doc('members/new-member');
    await ref.set(memberFields({ email: 'new@example.test' }));
    await (members.newMember as unknown as Trigger).run({
      data: await ref.get(),
      params: { memberId: 'new-member' },
    } as never);
    expect((await ref.get()).get('roles')).toEqual(['member']);
    expect(authCalls.setCustomUserClaims).toHaveBeenCalledWith('new-member', {
      roles: ['member'],
    });
  });
});
