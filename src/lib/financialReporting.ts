import { Contribution, Member, Payment } from 'tmbwa-shared/firebase';

export type ReportFilters = {
  from: string;
  to: string;
  memberId: string;
  status: string;
  paymentType: string;
};
export const kenyaMoney = new Intl.NumberFormat('en-KE', {
  style: 'currency',
  currency: 'KES',
  minimumFractionDigits: 2,
});
export const monthLabel = (month: string) =>
  new Intl.DateTimeFormat('en-KE', {
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Nairobi',
  }).format(new Date(`${month.slice(0, 7)}-01T00:00:00+03:00`));
export const timestampDate = (value: Payment['paymentdate']) =>
  value instanceof Date
    ? value
    : value && typeof value === 'object' && 'seconds' in value
      ? new Date(value.seconds * 1000)
      : null;
export const filterContributions = (
  items: Contribution[],
  filters: ReportFilters,
) =>
  items.filter(
    (item) =>
      (!filters.from || item.month >= `${filters.from}-01`) &&
      (!filters.to || item.month <= `${filters.to}-01`) &&
      (!filters.memberId || item.member_id === filters.memberId) &&
      (!filters.status || item.paid === filters.status),
  );
export const filterPayments = (items: Payment[], filters: ReportFilters) =>
  items.filter((item) => {
    const date = timestampDate(item.paymentdate);
    const month = date
      ? date
          .toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' })
          .slice(0, 7)
      : '';
    return (
      (!filters.from || month >= filters.from) &&
      (!filters.to || month <= filters.to) &&
      (!filters.memberId || item.member_id === filters.memberId) &&
      (!filters.paymentType || item.payment_type === filters.paymentType)
    );
  });
export const summarize = (
  contributions: Contribution[],
  payments: Payment[],
  members: Member[],
) => {
  const billed = contributions.reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0,
  );
  const collected = contributions.reduce(
    (sum, item) => sum + Number(item.amount || 0) - Number(item.balance || 0),
    0,
  );
  return {
    billed,
    collected,
    outstanding: Math.max(billed - collected, 0),
    accountCredit: members.reduce(
      (sum, member) => sum + Math.max(Number(member.balance || 0), 0),
      0,
    ),
    payments: payments.length,
    activeMembers: members.filter((member) => member.status === 'active')
      .length,
    collectionRate: billed > 0 ? collected / billed : 0,
  };
};
const csvCell = (value: unknown) => {
  const text = String(value ?? '');
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};
export const contributionCsv = (items: Contribution[]) =>
  [
    [
      'month',
      'member_id',
      'member_name',
      'status',
      'billed_kes',
      'collected_kes',
      'outstanding_kes',
    ],
    ...items.map((item) => [
      item.month,
      item.member_id,
      `${item.firstname} ${item.lastname}`,
      item.paid,
      item.amount,
      item.amount - item.balance,
      item.balance,
    ]),
  ]
    .map((row) => row.map(csvCell).join(','))
    .join('\n');
export const downloadCsv = (contents: string, filename: string) => {
  const url = URL.createObjectURL(
    new Blob([contents], { type: 'text/csv;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};
