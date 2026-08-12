import { Contribution, Member, Payment } from '@/schemas/member';
import { kenyaMoney, timestampDate } from './financialReporting';

export const receiptNumber = (payment: Payment) => payment.receipt_number || `TMBWA-${payment.payment_id.toUpperCase()}`;
const nairobiDate = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });

const printableWindow = (title: string) => {
  const popup = window.open('', '_blank');
  if (!popup) return null;
  popup.opener = null;
  popup.document.title = title;
  const main = popup.document.createElement('main');
  main.style.cssText = 'font-family:system-ui;max-width:900px;margin:40px auto';
  popup.document.body.append(main);
  return { popup, main };
};

const textElement = (document: Document, tag: string, text: string) => {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
};

export const printReceipt = (payment: Payment, member: Member) => {
  const output = printableWindow(receiptNumber(payment));
  if (!output) return;
  const { popup, main } = output;
  const date = timestampDate(payment.paymentdate);
  [
    ['h1', 'TMBWA Payment Receipt'],
    ['p', `Receipt: ${receiptNumber(payment)}`],
    ['p', `Member: ${member.firstname} ${member.lastname} (${member.membernumber})`],
    ['p', `Date: ${date?.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' }) || 'Pending'}`],
    ['p', `Reference: ${payment.referencenumber}`],
    ['p', `Type: ${payment.payment_type}`],
    ['h2', kenyaMoney.format(payment.amount)],
    ['p', `Contribution allocation: ${kenyaMoney.format(payment.contribution_amount)}`],
    ['small', 'Generated from TMBWA trusted financial records.'],
  ].forEach(([tag, text]) => main.append(textElement(popup.document, tag, text)));
  popup.print();
};

export const statementRows = (contributions: Contribution[], payments: Payment[]) => [
  ...contributions.map((item) => ({ date: item.month, description: `Monthly contribution – ${item.month.slice(0, 7)}`, charge: item.amount, payment: 0, reference: item.contribution_id })),
  ...payments.map((item) => {
    const isDeduction = item.payment_type === 'account' && item.balance_direction === 'deduction';
    const amount = item.payment_type === 'contribution' ? item.contribution_amount : item.amount;
    return { date: timestampDate(item.paymentdate) ? nairobiDate(timestampDate(item.paymentdate)!) : '', description: item.referencenumber, charge: isDeduction ? amount : 0, payment: isDeduction ? 0 : amount, reference: receiptNumber(item) };
  }),
].sort((a, b) => a.date.localeCompare(b.date));

export const printStatement = (member: Member, contributions: Contribution[], payments: Payment[], from: string, to: string) => {
  const output = printableWindow('Member statement');
  if (!output) return;
  const { popup, main } = output;
  const outstanding = contributions.reduce((sum, item) => sum + item.balance, 0);
  const rows = statementRows(contributions, payments).filter((row) => (!from || row.date >= from) && (!to || row.date <= to));
  main.append(textElement(popup.document, 'h1', 'TMBWA Member Statement'));
  main.append(textElement(popup.document, 'p', `${member.firstname} ${member.lastname} (${member.membernumber})`));
  main.append(textElement(popup.document, 'p', `Period: ${from || 'Beginning'} – ${to || 'Current'}`));
  main.append(textElement(popup.document, 'p', `Account balance: ${kenyaMoney.format(member.balance)} | Outstanding contributions: ${kenyaMoney.format(outstanding)}`));
  const table = popup.document.createElement('table');
  table.style.cssText = 'width:100%;border-collapse:collapse';
  const header = table.insertRow();
  ['Date', 'Description', 'Reference', 'Charge', 'Payment'].forEach((label) => header.append(textElement(popup.document, 'th', label)));
  rows.forEach((row) => { const line = table.insertRow(); [row.date, row.description, row.reference, kenyaMoney.format(row.charge), kenyaMoney.format(row.payment)].forEach((value) => line.append(textElement(popup.document, 'td', value))); });
  main.append(table, textElement(popup.document, 'p', `Current account balance: ${kenyaMoney.format(member.balance)}`));
  popup.print();
};
