import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RiHeartsLine } from '@remixicon/react';
import {
  BeneficiaryChangeRequestStatus,
  beneficiary_change_request_statuses,
} from 'tmbwa-shared';
import { Member } from 'tmbwa-shared/firebase';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Callout } from '@/components/Callout';
import { Card } from '@/components/Card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRoot,
  TableRow,
} from '@/components/Table';
import { Tabs, TabsList, TabsTrigger } from '@/components/Tabs';
import { DialogBeneficiaryReview } from '@/components/ui/beneficiaries/DialogBeneficiaryReview';
import {
  formatRequestTime,
  reasonLabel,
  requestStatusLabel,
  requestStatusVariant,
  requestTypeLabel,
} from '@/lib/beneficiaryDisplay';
import {
  BeneficiaryRequestRecord,
  subscribeBeneficiaryRequests,
} from '@/lib/firebase/beneficiaries';
import { getMembers } from '@/lib/firebase/firestore';

type StatusFilter = BeneficiaryChangeRequestStatus | 'all';
const filters: StatusFilter[] = [...beneficiary_change_request_statuses, 'all'];
const isStatusFilter = (value: string | null): value is StatusFilter =>
  filters.includes(value as StatusFilter);

export default function BeneficiaryRequestsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get('status');
  const status: StatusFilter = isStatusFilter(statusParam)
    ? statusParam
    : searchParams.get('request')
      ? 'all'
      : 'pending';
  const selectedId = searchParams.get('request');
  const [requests, setRequests] = useState<BeneficiaryRequestRecord[]>();
  const [members, setMembers] = useState<Map<string, Member>>(new Map());
  const [error, setError] = useState<string>();

  useEffect(() => {
    setRequests(undefined);
    setError(undefined);
    return subscribeBeneficiaryRequests(status, setRequests, () =>
      setError('Beneficiary requests could not be loaded. Please try again.'),
    );
  }, [status]);

  useEffect(
    () =>
      getMembers((list) =>
        setMembers(new Map(list.map((member) => [member.member_id, member]))),
      ),
    [],
  );

  const memberName = useMemo(
    () => (memberId: string) => {
      const member = members.get(memberId);
      return member ? `${member.firstname} ${member.lastname}` : memberId;
    },
    [members],
  );

  const updateParams = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(changes).forEach(([key, value]) =>
      value === null ? next.delete(key) : next.set(key, value),
    );
    setSearchParams(next);
  };

  const selected = requests?.find((request) => request.id === selectedId);

  return (
    <div className="mt-6 flex flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-50">
          <RiHeartsLine className="size-5" aria-hidden />
          Beneficiary requests
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Review members&apos; beneficiary changes. You cannot review your own.
        </p>
      </div>

      <Tabs
        value={status}
        onValueChange={(value) =>
          updateParams({ status: value, request: null })
        }
      >
        <TabsList variant="line" className="overflow-x-auto">
          {filters.map((filter) => (
            <TabsTrigger key={filter} value={filter}>
              {filter === 'all' ? 'All' : requestStatusLabel[filter]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {error ? (
        <Callout title="Something went wrong" variant="error">
          {error}
        </Callout>
      ) : (
        <Card className="p-0">
          {!requests ? (
            <p className="p-4 text-sm text-gray-500 dark:text-gray-400">
              Loading requests…
            </p>
          ) : requests.length === 0 ? (
            <p className="p-4 text-sm text-gray-500 dark:text-gray-400">
              {status === 'pending'
                ? 'No requests are waiting for review.'
                : 'No requests found.'}
            </p>
          ) : (
            <TableRoot>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Member</TableHeaderCell>
                    <TableHeaderCell>Type</TableHeaderCell>
                    <TableHeaderCell>Beneficiaries</TableHeaderCell>
                    <TableHeaderCell>Sent</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    {/* Relative so the visually hidden label stays inside the
                        table's scroll area instead of widening the page. */}
                    <TableHeaderCell className="relative">
                      <span className="sr-only">Actions</span>
                    </TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {requests.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell className="font-medium text-gray-900 dark:text-gray-50">
                        {memberName(request.memberId)}
                        <div className="text-xs font-normal text-gray-500 dark:text-gray-400">
                          {members.get(request.memberId)?.membernumber}
                        </div>
                      </TableCell>
                      <TableCell>
                        {requestTypeLabel[request.type]}
                        {request.reason ? (
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {reasonLabel(request.reason)}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {request.proposedBeneficiaries.length}
                      </TableCell>
                      <TableCell>
                        {formatRequestTime(request.submittedAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={requestStatusVariant[request.status]}>
                          {requestStatusLabel[request.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="secondary"
                          onClick={() => updateParams({ request: request.id })}
                        >
                          {request.status === 'pending' ? 'Review' : 'View'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableRoot>
          )}
        </Card>
      )}

      {selected ? (
        <DialogBeneficiaryReview
          request={selected}
          memberName={memberName(selected.memberId)}
          open
          onOpenChange={(open) => {
            if (!open) updateParams({ request: null });
          }}
        />
      ) : null}
    </div>
  );
}
