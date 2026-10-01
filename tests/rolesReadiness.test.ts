import { describe, expect, it } from 'vitest';
import { assessRolesReadiness, type ReadinessMember } from '../functions/src/members/readiness';

const member = (
  id: string,
  data: Record<string, unknown>,
  claims: ReadinessMember['claims'] = { roles: (data.roles as string[]) ?? [] },
): ReadinessMember => ({ id, data: { firstname: 'Synthetic', lastname: id, status: 'active', ...data }, claims });

const superAdmin = member('super-1', { roles: ['member', 'super_admin'] });

describe('roles readiness', () => {
  it('is ready when every officer record and claim carries roles', () => {
    const result = assessRolesReadiness([
      superAdmin,
      member('treasurer-1', { roles: ['member', 'treasurer'] }),
      member('member-1', { roles: ['member'] }, { role: 'member' }),
    ]);
    expect(result.blockers).toEqual([]);
    expect(result.staleClaims).toEqual([]);
    expect(result.officers.map((officer) => officer.id)).toEqual(['super-1', 'treasurer-1']);
  });

  it('blocks on records without roles', () => {
    const result = assessRolesReadiness([superAdmin, member('old-admin', { role: 'administrator' })]);
    expect(result.blockers).toEqual([expect.stringContaining('old-admin (Synthetic old-admin) has no roles field')]);
  });

  it('reports officers still relying on the legacy claim', () => {
    const legacy = member('admin-2', { roles: ['member', 'super_admin'] }, { role: 'administrator' });
    const mismatched = member('auditor-1', { roles: ['member', 'auditor'] }, { roles: ['treasurer'] });
    const result = assessRolesReadiness([superAdmin, legacy, mismatched]);
    expect(result.staleClaims.map((officer) => officer.id)).toEqual(['admin-2', 'auditor-1']);
  });

  it('blocks on officers without an Auth user', () => {
    const ghost: ReadinessMember = { ...member('ghost', { roles: ['member', 'registrar'] }), claims: undefined };
    const result = assessRolesReadiness([superAdmin, ghost]);
    expect(result.blockers).toEqual([expect.stringContaining('ghost')]);
  });

  it('blocks when no active super admin remains', () => {
    const result = assessRolesReadiness([
      member('super-1', { roles: ['member', 'super_admin'], status: 'suspended' }),
      member('treasurer-1', { roles: ['member', 'treasurer'] }),
    ]);
    expect(result.blockers).toEqual(['There is no active super admin. Assign one before deploying.']);
  });

  it('notes a retired administrator claim on a member who is no longer a super admin', () => {
    const result = assessRolesReadiness([
      superAdmin,
      member('former-admin', { roles: ['member'] }, { role: 'administrator' }),
    ]);
    expect(result.blockers).toEqual([]);
    expect(result.notes).toEqual([expect.stringContaining('former-admin')]);
  });

  it('notes more than three active super admins', () => {
    const supers = ['a', 'b', 'c', 'd'].map((id) => member(id, { roles: ['member', 'super_admin'] }));
    expect(assessRolesReadiness(supers).notes).toEqual([
      'There are 4 active super admins; consider narrower roles for some of them.',
    ]);
  });
});
