import { describe, expect, it } from 'vitest';
import { roleHasPermission, type Role } from 'tmbwa-shared';
import { isOfficer, landingPath, pagePermissions } from '../src/lib/access';

describe('officer landing pages', () => {
  it.each<[Role[], string]>([
    [['member'], '/profile'],
    [['member', 'super_admin'], '/overview'],
    [['member', 'treasurer'], '/overview'],
    [['member', 'auditor'], '/overview'],
    [['member', 'welfare_officer'], '/beneficiary-requests'],
    [['member', 'registrar'], '/members'],
    [['member', 'registrar', 'welfare_officer'], '/beneficiary-requests'],
  ])('sends %j to %s', (roles, path) => {
    expect(landingPath(roles)).toBe(path);
  });

  it('only lands officers on pages they can open', () => {
    const pageFor: Record<string, keyof typeof pagePermissions> = {
      '/overview': 'overview',
      '/beneficiary-requests': 'beneficiaryRequests',
      '/members': 'members',
    };
    for (const role of ['super_admin', 'treasurer', 'registrar', 'welfare_officer', 'auditor'] as Role[]) {
      const path = landingPath([role]);
      expect(roleHasPermission([role], pagePermissions[pageFor[path]])).toBe(true);
    }
  });
});

describe('officer pages', () => {
  it('keeps beneficiary screens away from auditors and treasurers', () => {
    for (const role of ['auditor', 'treasurer'] as Role[]) {
      expect(roleHasPermission([role], pagePermissions.beneficiaryRequests)).toBe(false);
    }
  });

  it('keeps financial screens away from registrars and welfare officers', () => {
    for (const role of ['registrar', 'welfare_officer'] as Role[]) {
      for (const page of ['overview', 'contributions', 'report', 'audit', 'kcbReconciliation'] as const) {
        expect(roleHasPermission([role], pagePermissions[page])).toBe(false);
      }
    }
  });

  it('treats any non-member role as an officer', () => {
    expect(isOfficer(['member'])).toBe(false);
    expect(isOfficer([])).toBe(false);
    expect(isOfficer(['member', 'auditor'])).toBe(true);
  });
});
