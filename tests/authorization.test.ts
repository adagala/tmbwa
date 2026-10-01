import { describe, expect, it } from 'vitest';
import {
  ROLE_PERMISSIONS,
  memberRoles,
  normalizeRoles,
  permissions,
  roleHasPermission,
  roles,
  rolesFromClaims,
  type Permission,
  type Role,
} from 'tmbwa-shared';

// The agreed role model (issue #73). Changing a role's permissions must be a
// deliberate decision, so this table is spelled out rather than derived.
const expected: Record<Role, Permission[]> = {
  member: [],
  super_admin: [...permissions],
  treasurer: [
    'members.read',
    'payments.read',
    'payments.record',
    'payments.reverse',
    'contributions.manage',
    'balances.adjust',
    'kcb.reconcile',
    'audit.read',
    'reports.read',
  ],
  registrar: ['members.read', 'members.write', 'members.status'],
  welfare_officer: ['members.read', 'beneficiaries.read', 'beneficiaries.review'],
  auditor: ['members.read', 'payments.read', 'audit.read', 'reports.read'],
};

describe('role permissions', () => {
  it.each(roles)('grants %s exactly the agreed permissions', (role) => {
    expect([...ROLE_PERMISSIONS[role]].sort()).toEqual([...expected[role]].sort());
  });

  it('never lets auditors or treasurers read beneficiary personal data', () => {
    expect(roleHasPermission(['auditor'], 'beneficiaries.read')).toBe(false);
    expect(roleHasPermission(['treasurer'], 'beneficiaries.read')).toBe(false);
  });

  it('keeps role management with super admins only', () => {
    for (const role of roles) {
      expect(roleHasPermission([role], 'roles.manage')).toBe(role === 'super_admin');
    }
  });

  it('combines the permissions of several roles', () => {
    const officer: Role[] = ['registrar', 'welfare_officer'];
    expect(roleHasPermission(officer, 'members.write')).toBe(true);
    expect(roleHasPermission(officer, 'beneficiaries.review')).toBe(true);
    expect(roleHasPermission(officer, 'payments.read')).toBe(false);
    expect(roleHasPermission(officer, 'audit.read')).toBe(false);
  });

  it('grants nothing without roles', () => {
    expect(roleHasPermission([], 'members.read')).toBe(false);
  });
});

describe('rolesFromClaims', () => {
  it('reads the roles claim', () => {
    expect(rolesFromClaims({ roles: ['welfare_officer', 'registrar'] })).toEqual([
      'registrar',
      'welfare_officer',
    ]);
  });

  it('ignores the retired single role claim', () => {
    expect(rolesFromClaims({ role: 'administrator' })).toEqual([]);
    expect(rolesFromClaims({ role: 'member' })).toEqual([]);
  });

  it('ignores unknown and malformed values', () => {
    expect(rolesFromClaims({ roles: ['owner', 7, 'auditor'], role: 'root' })).toEqual(['auditor']);
    expect(rolesFromClaims({ roles: 'super_admin' })).toEqual([]);
    expect(rolesFromClaims(undefined)).toEqual([]);
  });

  it('does not duplicate roles', () => {
    expect(rolesFromClaims({ roles: ['super_admin', 'super_admin'], role: 'administrator' })).toEqual([
      'super_admin',
    ]);
  });
});

describe('member record roles', () => {
  it('normalizes role lists', () => {
    expect(normalizeRoles(['auditor', 'treasurer', 'auditor', 'owner'])).toEqual([
      'member',
      'treasurer',
      'auditor',
    ]);
    expect(normalizeRoles([])).toEqual(['member']);
  });

  it('reads roles only from the roles field', () => {
    expect(memberRoles({ roles: ['member', 'registrar'], role: 'member' })).toEqual([
      'member',
      'registrar',
    ]);
    expect(memberRoles({ roles: ['member'], role: 'administrator' })).toEqual(['member']);
  });

  it('grants nothing for the retired role field', () => {
    expect(memberRoles({ role: 'administrator' })).toEqual(['member']);
    expect(memberRoles({ role: 'member' })).toEqual(['member']);
    expect(memberRoles(undefined)).toEqual(['member']);
  });
});
