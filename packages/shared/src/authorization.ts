// ---------------------------------------------------------------------------
// Roles and permissions
// ---------------------------------------------------------------------------
//
// Authorization is permission-based. A user holds one or more roles through
// the `roles` custom claim, and each role grants a fixed set of permissions.
// Trusted backend commands check permissions, never role names.
//
// Transitional: the legacy `role: 'administrator'` claim is treated as
// `super_admin` until every administrator has been assigned specific roles.

export const ROLE = {
  MEMBER: 'member',
  SUPER_ADMIN: 'super_admin',
  TREASURER: 'treasurer',
  REGISTRAR: 'registrar',
  WELFARE_OFFICER: 'welfare_officer',
  AUDITOR: 'auditor',
} as const;

export const roles = [
  ROLE.MEMBER,
  ROLE.SUPER_ADMIN,
  ROLE.TREASURER,
  ROLE.REGISTRAR,
  ROLE.WELFARE_OFFICER,
  ROLE.AUDITOR,
] as const;

export type Role = (typeof roles)[number];

export const permissions = [
  'members.read',
  'members.write',
  'members.status',
  'members.delete',
  'beneficiaries.read',
  'beneficiaries.review',
  'payments.read',
  'payments.record',
  'payments.reverse',
  'contributions.manage',
  'balances.adjust',
  'kcb.reconcile',
  'audit.read',
  'reports.read',
  'roles.manage',
  'rates.manage',
  'notifications.retry',
] as const;

export type Permission = (typeof permissions)[number];

const financePermissions: readonly Permission[] = [
  'payments.read',
  'payments.record',
  'payments.reverse',
  'contributions.manage',
  'balances.adjust',
  'kcb.reconcile',
];

// Members act on their own records only; ownership is checked separately,
// so the member role grants no administrative permissions.
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  member: [],
  super_admin: permissions,
  treasurer: ['members.read', ...financePermissions, 'audit.read', 'reports.read'],
  registrar: ['members.read', 'members.write', 'members.status'],
  welfare_officer: ['members.read', 'beneficiaries.read', 'beneficiaries.review'],
  // Auditors never see beneficiaries' personal data.
  auditor: ['members.read', 'payments.read', 'audit.read', 'reports.read'],
};

const LEGACY_ADMINISTRATOR_ROLE = 'administrator';

const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && (roles as readonly string[]).includes(value);

// Resolves roles from verified token claims. Unknown values are ignored.
export const rolesFromClaims = (claims: Record<string, unknown> | undefined): Role[] => {
  if (!claims) return [];
  const resolved = new Set<Role>(Array.isArray(claims.roles) ? claims.roles.filter(isRole) : []);
  if (claims.role === LEGACY_ADMINISTRATOR_ROLE) resolved.add(ROLE.SUPER_ADMIN);
  if (claims.role === ROLE.MEMBER) resolved.add(ROLE.MEMBER);
  return roles.filter((role) => resolved.has(role));
};

export const roleHasPermission = (roleList: readonly Role[], permission: Permission) =>
  roleList.some((role) => ROLE_PERMISSIONS[role].includes(permission));
