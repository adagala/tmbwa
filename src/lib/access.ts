import { Permission, Role, roleHasPermission } from 'tmbwa-shared';

// Interface hints only. Firestore rules and trusted commands enforce access;
// these keep people away from screens that would only show errors.

// The permission each officer page needs to load its data.
export const pagePermissions = {
  overview: 'reports.read',
  members: 'members.read',
  contributions: 'payments.read',
  report: 'reports.read',
  audit: 'audit.read',
  kcbReconciliation: 'kcb.reconcile',
  beneficiaryRequests: 'beneficiaries.review',
} as const satisfies Record<string, Permission>;

// Where each officer lands after signing in, most useful page first.
const landingPages: [string, Permission][] = [
  ['/overview', pagePermissions.overview],
  ['/beneficiary-requests', pagePermissions.beneficiaryRequests],
  ['/members', pagePermissions.members],
];

export const landingPath = (roles: readonly Role[]) =>
  landingPages.find(([, permission]) =>
    roleHasPermission(roles, permission),
  )?.[0] ?? '/profile';

// Officers see the administrator guide and officer screens.
export const isOfficer = (roles: readonly Role[]) =>
  roles.some((role) => role !== 'member');
