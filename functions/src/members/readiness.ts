import { UserRecord } from 'firebase-admin/auth';
import { admin } from '../firebaseAdmin';
import { arrayToChunks } from '../utils';
import { syncRoleClaims, transitionalClaims } from './claims';
import {
  MEMBER_STATUS,
  ROLE,
  type Role,
  memberRoles,
  normalizeRoles,
  rolesFromClaims,
  sameRoles,
} from 'tmbwa-shared';

export const MAX_SUPER_ADMINS = 3;

export type ReadinessMember = {
  id: string;
  data: Record<string, unknown>;
  // undefined when the member has no Firebase Auth user.
  claims: Record<string, unknown> | undefined | null;
};

export type Officer = { id: string; name: string; status: string; roles: Role[] };

export type Readiness = {
  officers: Officer[];
  // Officers whose claims do not carry the roles on their record.
  staleClaims: Officer[];
  blockers: string[];
  notes: string[];
};

export const describeOfficer = ({ id, name, status, roles }: Officer) =>
  `${id} (${name || 'unnamed'}, ${status}): ${roles.filter((role) => role !== ROLE.MEMBER).join(', ')}`;

// Whether access can safely come from `roles` alone, i.e. whether the legacy
// `role: administrator` can be retired. Stale claims are reported separately
// so the caller can either block on them or sync them.
export const assessRolesReadiness = (members: ReadinessMember[]): Readiness => {
  const readiness: Readiness = { officers: [], staleClaims: [], blockers: [], notes: [] };
  members.forEach(({ id, data, claims }) => {
    const name = `${data.firstname ?? ''} ${data.lastname ?? ''}`.trim();
    if (!Array.isArray(data.roles)) {
      readiness.blockers.push(`${id} (${name || 'unnamed'}) has no roles field; run backfill:member-roles first.`);
      return;
    }
    const roles = memberRoles(data);
    const officer = { id, name, status: String(data.status ?? 'unknown'), roles };
    if (roles.some((role) => role !== ROLE.MEMBER)) {
      readiness.officers.push(officer);
      if (claims === undefined) {
        readiness.blockers.push(`${describeOfficer(officer)} has no Firebase Auth user.`);
      } else if (!sameRoles(normalizeRoles(rolesFromClaims(claims ?? undefined)), roles)) {
        readiness.staleClaims.push(officer);
      }
    }
    if (claims?.role === 'administrator' && !roles.includes(ROLE.SUPER_ADMIN)) {
      readiness.notes.push(
        `${id} (${name || 'unnamed'}) still has the legacy administrator claim but is not a super admin; ` +
          'it will grant nothing after the release.',
      );
    }
  });

  const activeSuperAdmins = readiness.officers.filter(
    (officer) => officer.status === MEMBER_STATUS.ACTIVE && officer.roles.includes(ROLE.SUPER_ADMIN),
  );
  if (!activeSuperAdmins.length) {
    readiness.blockers.push('There is no active super admin. Assign one before deploying.');
  } else if (activeSuperAdmins.length > MAX_SUPER_ADMINS) {
    readiness.notes.push(`There are ${activeSuperAdmins.length} active super admins; consider narrower roles for some of them.`);
  }
  return readiness;
};

// Reads every member record and their Auth claims as they are now.
export const collectReadinessMembers = async (): Promise<ReadinessMember[]> => {
  const snapshot = await admin.firestore().collection('members').get();
  const users = new Map<string, UserRecord>();
  for (const chunk of arrayToChunks(snapshot.docs, 100)) {
    const result = await admin.auth().getUsers(chunk.map((doc) => ({ uid: doc.id })));
    result.users.forEach((user) => users.set(user.uid, user));
  }
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    data: doc.data(),
    claims: users.has(doc.id) ? (users.get(doc.id)?.customClaims ?? null) : undefined,
  }));
};

export type ReadinessRun = Readiness & { synced: string[] };

// Assesses readiness and, with syncClaims, repairs officers' claims. Claims
// are written through syncRoleClaims, which rereads each record and retries
// until the roles it wrote are still current, so a reassignment made while
// the report runs is never overwritten with the roles it first read. The
// result is then reassessed from fresh state, and any claims still stale
// become blockers.
export const runRolesReadiness = async ({ syncClaims }: { syncClaims: boolean }): Promise<ReadinessRun> => {
  let readiness = assessRolesReadiness(await collectReadinessMembers());
  const synced: string[] = [];
  if (syncClaims) {
    for (const officer of readiness.staleClaims) {
      await syncRoleClaims(officer.id, transitionalClaims);
      synced.push(officer.id);
    }
    if (synced.length) readiness = assessRolesReadiness(await collectReadinessMembers());
  }
  readiness.staleClaims.forEach((officer) =>
    readiness.blockers.push(`${describeOfficer(officer)}: claims do not carry these roles; run with --sync-claims.`));
  return { ...readiness, synced };
};
