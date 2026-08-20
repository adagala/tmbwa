import { useEffect, useMemo, useState } from 'react';
import { RiDownloadLine, RiFileTextLine } from '@remixicon/react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Label } from '@/components/Label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/Select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRoot,
  TableRow,
} from '@/components/Table';
import { Contribution, Member, Payment } from 'tmbwa-shared/firebase';
import {
  getAllContributions,
  getAllPayments,
  getMembers,
} from '@/lib/firebase/firestore';
import {
  contributionCsv,
  downloadCsv,
  filterContributions,
  filterPayments,
  kenyaMoney,
  monthLabel,
  ReportFilters,
  summarize,
} from '@/lib/financialReporting';

const initialFilters: ReportFilters = {
  from: '',
  to: '',
  memberId: '',
  status: '',
  paymentType: '',
};
export default function ReportPage() {
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [filters, setFilters] = useState(initialFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let loaded = 0;
    const done = () => {
      loaded += 1;
      if (loaded === 3) setLoading(false);
    };
    const fail = (reason: Error) => {
      setError(reason.message);
      setLoading(false);
    };
    const stops = [
      getAllContributions((items) => {
        setContributions(items);
        done();
      }, fail),
      getAllPayments((items) => {
        setPayments(items);
        done();
      }, fail),
      getMembers((items) => {
        setMembers(items);
        done();
      }),
    ];
    return () => stops.forEach((stop) => stop());
  }, []);
  const visibleContributions = useMemo(
    () => filterContributions(contributions, filters),
    [contributions, filters],
  );
  const visiblePayments = useMemo(
    () => filterPayments(payments, filters),
    [payments, filters],
  );
  const visibleMembers = useMemo(
    () =>
      filters.memberId
        ? members.filter((member) => member.member_id === filters.memberId)
        : members,
    [filters.memberId, members],
  );
  const summary = useMemo(
    () => summarize(visibleContributions, visiblePayments, visibleMembers),
    [visibleContributions, visiblePayments, visibleMembers],
  );
  const months = useMemo(
    () =>
      Object.values(
        visibleContributions.reduce<
          Record<string, { month: string; billed: number; collected: number }>
        >((all, item) => {
          const row = all[item.month] ?? {
            month: item.month,
            billed: 0,
            collected: 0,
          };
          row.billed += item.amount;
          row.collected += item.amount - item.balance;
          all[item.month] = row;
          return all;
        }, {}),
      ).sort((a, b) => b.month.localeCompare(a.month)),
    [visibleContributions],
  );
  const set = (key: keyof ReportFilters, value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));
  return (
    <div className="flex flex-col gap-6">
      <h1 className="mt-6 flex items-center gap-2 text-xl font-bold text-guardsman-red-600">
        <RiFileTextLine /> Financial report
      </h1>
      <p className="text-sm text-gray-600">
        Billed is the amount charged. Collected is the amount applied to
        charges. Outstanding is billed less collected; account credit is held
        separately.
      </p>
      <Card className="grid gap-3 md:grid-cols-5">
        <div className="space-y-1">
          <Label htmlFor="report-from">From month</Label>
          <Input
            id="report-from"
            type="month"
            value={filters.from}
            onChange={(event) => set('from', event.target.value)}
            className="mt-1 w-full rounded border p-2"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="report-to">To month</Label>
          <Input
            id="report-to"
            type="month"
            value={filters.to}
            onChange={(event) => set('to', event.target.value)}
            className="mt-1 w-full rounded border p-2"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="report-member">Member</Label>
          <Select
            value={filters.memberId || 'all'}
            onValueChange={(value) =>
              set('memberId', value === 'all' ? '' : value)
            }
          >
            <SelectTrigger id="report-member">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All members</SelectItem>
              {members.map((member) => (
                <SelectItem key={member.member_id} value={member.member_id}>
                  {member.firstname} {member.lastname}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="report-status">Charge status</Label>
          <Select
            value={filters.status || 'all'}
            onValueChange={(value) =>
              set('status', value === 'all' ? '' : value)
            }
          >
            <SelectTrigger id="report-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="partial">Partial</SelectItem>
              <SelectItem value="unpaid">Unpaid</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="report-payment-type">Payment type</Label>
          <Select
            value={filters.paymentType || 'all'}
            onValueChange={(value) =>
              set('paymentType', value === 'all' ? '' : value)
            }
          >
            <SelectTrigger id="report-payment-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="contribution">Contribution</SelectItem>
              <SelectItem value="account">Account</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>
      {error ? (
        <Card className="text-red-700">
          Unable to load reporting data: {error}
        </Card>
      ) : null}
      {loading ? (
        <p className="text-sm text-gray-500">Loading financial report…</p>
      ) : null}
      {!loading && !error ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Billed', kenyaMoney.format(summary.billed)],
              ['Collected', kenyaMoney.format(summary.collected)],
              ['Outstanding', kenyaMoney.format(summary.outstanding)],
              ['Account credit', kenyaMoney.format(summary.accountCredit)],
              [
                'Collection rate',
                `${(summary.collectionRate * 100).toFixed(1)}%`,
              ],
              ['Payments', summary.payments],
              ['Active members', summary.activeMembers],
            ].map(([label, value]) => (
              <Card key={label} className="space-y-1">
                <p className="text-sm text-gray-500">{label}</p>
                <p className="text-xl font-semibold">{value}</p>
              </Card>
            ))}
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              className="gap-2"
              onClick={() =>
                downloadCsv(
                  contributionCsv(visibleContributions),
                  `tmbwa-financial-report-${filters.from || 'all'}-${filters.to || 'all'}.csv`,
                )
              }
            >
              <RiDownloadLine className="size-4" />
              Export CSV
            </Button>
          </div>
          {months.length === 0 ? (
            <Card className="text-sm text-gray-500">
              No financial records match these filters.
            </Card>
          ) : (
            <TableRoot>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Month</TableHeaderCell>
                    <TableHeaderCell>Billed</TableHeaderCell>
                    <TableHeaderCell>Collected</TableHeaderCell>
                    <TableHeaderCell>Outstanding</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {months.map((row) => (
                    <TableRow key={row.month}>
                      <TableCell className="font-medium">
                        {monthLabel(row.month)}
                      </TableCell>
                      <TableCell>{kenyaMoney.format(row.billed)}</TableCell>
                      <TableCell>{kenyaMoney.format(row.collected)}</TableCell>
                      <TableCell>
                        {kenyaMoney.format(row.billed - row.collected)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableRoot>
          )}
        </>
      ) : null}
    </div>
  );
}
