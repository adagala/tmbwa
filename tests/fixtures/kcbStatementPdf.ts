// Builds synthetic KCB account statement PDFs for tests (#94). The text items
// follow the layout pdf.js extracts from real KCB statements: one item per
// cell, M-Pesa details split over two items, and page numbers. No real
// member data.

export type StatementRow = {
  date: string;
  details: string[];
  out: string;
  in: string;
  balance: string;
  reference?: string;
};

export type StatementHeader = {
  account: string;
  period: string;
  start: string;
  end: string;
  moneyIn: string;
  moneyOut: string;
};

export const statementItems = (header: StatementHeader, rows: StatementRow[]) => {
  const rowItems = (row: StatementRow) => [
    row.date, row.date, ...row.details, row.out, row.in, row.balance, ...(row.reference ? [row.reference] : []),
  ];
  return [
    '1', 'Account Statement', 'Date: 03/10/2026 11:54:48',
    `Account: ${header.account}`,
    'Account Name: SAMPLE WELFARE ASSOCIATION',
    'Available Balance: KES 9,999,999.99',
    `Period: ${header.period}`,
    `Balance At Period Start: ${header.start}`,
    `Balance At Period End: ${header.end}`,
    `Total Money In: ${header.moneyIn}`,
    `Total Money Out: ${header.moneyOut}`,
    'Transaction', 'Date', 'Value Date', 'Transaction Details', 'Money Out', 'Money In', 'Ledger Balance',
    'Bank', 'Reference', 'Number',
    ...rows.flatMap((row, index) => (index === 2 ? ['2', ...rowItems(row)] : rowItems(row))),
  ];
};

const escape = (text: string) => text.replace(/[\\()]/g, (character) => `\\${character}`);

// A minimal PDF drawing each item as its own text object, in order.
export const textPdf = (items: string[]) => {
  const height = 40 + items.length * 12;
  const content = items
    .map((item, index) => `BT /F1 8 Tf 40 ${height - 20 - index * 12} Td (${escape(item)}) Tj ET`)
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 ${height}] ` +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(pdf, 'latin1');
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
};

export const statementPdf = (header: StatementHeader, rows: StatementRow[]) =>
  textPdf(statementItems(header, rows));
