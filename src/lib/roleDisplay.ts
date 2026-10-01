import { Role } from 'tmbwa-shared';

export const roleLabels: Record<Role, string> = {
  member: 'Member',
  super_admin: 'Super admin',
  treasurer: 'Treasurer',
  registrar: 'Registrar',
  welfare_officer: 'Welfare officer',
  auditor: 'Auditor',
};

export const roleDescriptions: Record<Role, string> = {
  member: 'Every member. Sees and manages only their own records.',
  super_admin:
    'Full access, including finance, member deletion, contribution rates and role management.',
  treasurer:
    'Payments, contributions, KCB reconciliation, reports and the audit log.',
  registrar: 'Member details and member status.',
  welfare_officer:
    'Reviews beneficiary changes. Can see member contact details.',
  auditor:
    'Read-only access to payments, reports and the audit log. No beneficiary personal data.',
};

// Officer roles in display order; `member` is always held and not toggled.
export const officerRoles: Role[] = [
  'super_admin',
  'treasurer',
  'registrar',
  'welfare_officer',
  'auditor',
];

export const describeRoles = (roles: readonly Role[]) => {
  const officer = officerRoles.filter((role) => roles.includes(role));
  return officer.length
    ? officer.map((role) => roleLabels[role]).join(', ')
    : roleLabels.member;
};
