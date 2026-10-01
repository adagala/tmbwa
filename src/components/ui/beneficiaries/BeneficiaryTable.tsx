import { Beneficiary } from 'tmbwa-shared';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRoot,
  TableRow,
} from '@/components/Table';
import { formatDateOfBirth, relationshipLabel } from '@/lib/beneficiaryDisplay';

export function BeneficiaryTable({
  beneficiaries,
  emptyMessage = 'No beneficiaries recorded.',
}: {
  beneficiaries: Beneficiary[];
  emptyMessage?: string;
}) {
  if (beneficiaries.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">{emptyMessage}</p>
    );
  }
  return (
    <TableRoot>
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Name</TableHeaderCell>
            <TableHeaderCell>Relationship</TableHeaderCell>
            <TableHeaderCell>Date of birth</TableHeaderCell>
            <TableHeaderCell>Contact</TableHeaderCell>
            <TableHeaderCell>ID number</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {beneficiaries.map((beneficiary, index) => (
            <TableRow
              key={`${beneficiary.firstname}-${beneficiary.lastname}-${index}`}
            >
              <TableCell className="font-medium text-gray-900 dark:text-gray-50">
                {beneficiary.firstname} {beneficiary.lastname}
              </TableCell>
              <TableCell>{relationshipLabel(beneficiary)}</TableCell>
              <TableCell>
                {formatDateOfBirth(beneficiary.dateOfBirth)}
              </TableCell>
              <TableCell>
                <div className="flex flex-col">
                  <span>{beneficiary.phonenumber ?? '—'}</span>
                  {beneficiary.email ? (
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {beneficiary.email}
                    </span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell>{beneficiary.idnumber ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableRoot>
  );
}
