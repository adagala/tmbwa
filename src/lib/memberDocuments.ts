import { Contribution, Member, Payment } from '@/schemas/member';
import { kenyaMoney, timestampDate } from './financialReporting';

export const receiptNumber = (payment: Payment) => payment.receipt_number || `TMBWA-${payment.payment_id.toUpperCase()}`;
export const printReceipt = (payment: Payment, member: Member) => {
  const date = timestampDate(payment.paymentdate);
  const popup = window.open('', '_blank', 'noopener,noreferrer');
  if (!popup) return;
  popup.document.write(`<title>${receiptNumber(payment)}</title><main style="font-family:system-ui;max-width:640px;margin:40px auto"><h1>TMBWA Payment Receipt</h1><hr><p><b>Receipt:</b> ${receiptNumber(payment)}</p><p><b>Member:</b> ${member.firstname} ${member.lastname} (${member.membernumber})</p><p><b>Date:</b> ${date?.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' }) || 'Pending'}</p><p><b>Reference:</b> ${payment.referencenumber}</p><p><b>Type:</b> ${payment.payment_type}</p><h2>${kenyaMoney.format(payment.amount)}</h2><p>Contribution allocation: ${kenyaMoney.format(payment.contribution_amount)}</p><hr><small>Generated from TMBWA trusted financial records.</small></main>`);
  popup.document.close(); popup.print();
};

export const statementRows = (contributions: Contribution[], payments: Payment[]) => [
  ...contributions.map((item) => ({ date: item.month, description: `Monthly contribution – ${item.month.slice(0, 7)}`, charge: item.amount, payment: 0, reference: item.contribution_id })),
  ...payments.map((item) => ({ date: timestampDate(item.paymentdate)?.toISOString().slice(0, 10) || '', description: item.referencenumber, charge: 0, payment: item.payment_type === 'contribution' ? item.contribution_amount : item.amount, reference: receiptNumber(item) })),
].sort((a, b) => a.date.localeCompare(b.date));
