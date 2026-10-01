import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// Runs against the Firestore emulator only (see `npm run test:integration`).
process.env.GCLOUD_PROJECT = 'demo-tmbwa';

const { admin } = await import('../functions/src/firebaseAdmin');
admin.initializeApp({ projectId: 'demo-tmbwa' });
const { runRolesReadiness } = await import('../functions/src/members/readiness');
const { restoreLegacyRoleFields } = await import('../functions/src/members/rollback');

const db = () => admin.firestore();

// A stateful stand-in for Firebase Auth: claims persist between calls, and a
// hook can run once when users are next read.
const claimsByUid = new Map<string, Record<string, unknown>>();
let onNextGetUsers: (() => Promise<void>) | undefined;
const auth = {
  getUsers: vi.fn(async (ids: { uid: string }[]) => {
    const hook = onNextGetUsers;
    onNextGetUsers = undefined;
    await hook?.();
    return {
      users: ids
        .filter(({ uid }) => claimsByUid.has(uid))
        .map(({ uid }) => ({ uid, customClaims: claimsByUid.get(uid) })),
    };
  }),
  setCustomUserClaims: vi.fn(async (uid: string, claims: Record<string, unknown>) => {
    claimsByUid.set(uid, claims);
  }),
};
vi.spyOn(admin, 'auth').mockImplementation(() => auth as never);

const seedMember = async (id: string, data: Record<string, unknown>, claims?: Record<string, unknown>) => {
  await db().doc(`members/${id}`).set({ firstname: 'Synthetic', lastname: id, status: 'active', ...data });
  if (claims) claimsByUid.set(id, claims);
};

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
  claimsByUid.clear();
  onNextGetUsers = undefined;
  Object.values(auth).forEach((fn) => fn.mockClear());
  await seedMember('super-1', { roles: ['member', 'super_admin'] }, { roles: ['member', 'super_admin'] });
});

afterAll(async () => {
  vi.restoreAllMocks();
  await clearFirestore();
});

describe('roles readiness --sync-claims', () => {
  it('syncs an officer still on the legacy claim and is then ready', async () => {
    await seedMember('treasurer-1', { roles: ['member', 'treasurer'] }, { role: 'member' });
    const result = await runRolesReadiness({ syncClaims: true });
    expect(result.synced).toEqual(['treasurer-1']);
    expect(claimsByUid.get('treasurer-1')).toEqual({ roles: ['member', 'treasurer'], role: 'member' });
    expect(result.blockers).toEqual([]);
  });

  it('never overwrites a reassignment made while the report runs', async () => {
    await seedMember('officer-1', { roles: ['member', 'treasurer'] }, { role: 'member' });
    // After the records are read and before claims are written, the officer
    // is reassigned to registrar, as assignMemberRoles would do.
    onNextGetUsers = async () => {
      await db().doc('members/officer-1').update({ roles: ['member', 'registrar'] });
      claimsByUid.set('officer-1', { roles: ['member', 'registrar'] });
    };
    const result = await runRolesReadiness({ syncClaims: true });
    expect(claimsByUid.get('officer-1')).toEqual({ roles: ['member', 'registrar'], role: 'member' });
    expect(result.blockers).toEqual([]);
    expect(result.officers.find((officer) => officer.id === 'officer-1')?.roles).toEqual([
      'member',
      'registrar',
    ]);
  });

  it('reports claims still stale after syncing as blockers from fresh state', async () => {
    await seedMember('auditor-1', { roles: ['member', 'auditor'] }, { role: 'member' });
    auth.setCustomUserClaims.mockImplementationOnce(async () => undefined);
    const result = await runRolesReadiness({ syncClaims: true });
    expect(result.blockers).toEqual([expect.stringContaining('auditor-1')]);
  });

  it('writes nothing without --sync-claims', async () => {
    await seedMember('treasurer-1', { roles: ['member', 'treasurer'] }, { role: 'member' });
    const result = await runRolesReadiness({ syncClaims: false });
    expect(auth.setCustomUserClaims).not.toHaveBeenCalled();
    expect(result.blockers).toEqual([expect.stringContaining('treasurer-1')]);
  });
});

describe('rollback repair', () => {
  // What the previous release (Roles 3/4) requires of every member record.
  const previousReleaseMember = z.object({ role: z.enum(['member', 'administrator']) });

  it('restores the retired field and claim for members created under roles-only access', async () => {
    // Created by the roles-only release: no `role` field, claims { roles }.
    await seedMember('new-member', { roles: ['member'] }, { roles: ['member'] });
    await seedMember('new-super', { roles: ['member', 'super_admin'] }, { roles: ['member', 'super_admin'] });
    await seedMember('new-registrar', { roles: ['member', 'registrar'] }, { roles: ['member', 'registrar'] });

    const dryRun = await restoreLegacyRoleFields({ apply: false });
    expect(dryRun.fields.sort()).toEqual(['new-member', 'new-registrar', 'new-super', 'super-1']);
    expect((await db().doc('members/new-member').get()).get('role')).toBeUndefined();
    expect(auth.setCustomUserClaims).not.toHaveBeenCalled();

    await restoreLegacyRoleFields({ apply: true });
    for (const [id, role] of [['new-member', 'member'], ['new-super', 'administrator'], ['new-registrar', 'member']]) {
      const data = (await db().doc(`members/${id}`).get()).data();
      expect(previousReleaseMember.safeParse(data).success).toBe(true);
      expect(data?.role).toBe(role);
      expect(claimsByUid.get(id)).toMatchObject({ role });
    }
    // Roles themselves are untouched.
    expect((await db().doc('members/new-registrar').get()).get('roles')).toEqual(['member', 'registrar']);
  });

  it('has nothing left to do on a second run', async () => {
    await seedMember('new-member', { roles: ['member'] }, { roles: ['member'] });
    await restoreLegacyRoleFields({ apply: true });
    expect(await restoreLegacyRoleFields({ apply: false })).toEqual({ fields: [], claims: [] });
  });
});
