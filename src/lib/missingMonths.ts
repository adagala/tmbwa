import { MONTHLY_CONTRIBUTION } from 'tmbwa-shared';

export type MonthCreditPreview = {
  month: string;
  fromCredit: number;
  due: number;
};

// Unreserved credit the server applies to new contributions.
export const unreservedCredit = (member: {
  balance?: number;
  reservedKcbCredit?: number;
}) => Math.max((member.balance || 0) - (member.reservedKcbCredit || 0), 0);

// Mirrors createContributions: months are billed oldest first and credit
// settles the oldest month first. The server's result is authoritative.
export const previewMissingMonths = (
  months: string[],
  member: { balance?: number; reservedKcbCredit?: number },
) => {
  let credit = unreservedCredit(member);
  const rows: MonthCreditPreview[] = [...months].sort().map((month) => {
    const fromCredit = Math.min(credit, MONTHLY_CONTRIBUTION);
    credit -= fromCredit;
    return { month, fromCredit, due: MONTHLY_CONTRIBUTION - fromCredit };
  });
  const total = rows.length * MONTHLY_CONTRIBUTION;
  return {
    rows,
    total,
    fromCredit: rows.reduce((sum, row) => sum + row.fromCredit, 0),
    balanceAfter: (member.balance || 0) - total,
  };
};

// The oldest months that unreserved credit pays in full.
export const monthsCoveredByCredit = (
  months: string[],
  member: { balance?: number; reservedKcbCredit?: number },
) =>
  [...months]
    .sort()
    .slice(0, Math.floor(unreservedCredit(member) / MONTHLY_CONTRIBUTION));
