import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RiAddLine, RiEdit2Line, RiExternalLinkLine } from '@remixicon/react';
import { BeneficiaryState } from 'tmbwa-shared';
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
import { BeneficiaryTable } from '@/components/ui/beneficiaries/BeneficiaryTable';
import { DialogBeneficiaryForm } from '@/components/ui/beneficiaries/DialogBeneficiaryForm';
import { toast } from '@/hooks/useToast';
import useUser from '@/hooks/useUser';
import {
  formatRequestTime,
  reasonLabel,
  requestStatusLabel,
  requestStatusVariant,
  requestTypeLabel,
  expectedRequestKind,
} from '@/lib/beneficiaryDisplay';
import {
  BeneficiaryRecord,
  BeneficiaryRequestRecord,
  cancelBeneficiaryChange,
  commandErrorMessage,
  subscribeBeneficiaries,
  subscribeBeneficiaryState,
  subscribeMemberBeneficiaryRequests,
} from '@/lib/firebase/beneficiaries';

function PendingRequest({
  request,
  canCancel,
  reviewLink,
}: {
  request: BeneficiaryRequestRecord;
  canCancel: boolean;
  reviewLink: boolean;
}) {
  const [isCancelling, setIsCancelling] = useState(false);
  const cancel = async () => {
    setIsCancelling(true);
    try {
      await cancelBeneficiaryChange(request.id);
      toast({
        title: 'Request cancelled',
        description: 'Your beneficiaries are unchanged.',
        variant: 'success',
        duration: 3000,
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: commandErrorMessage(
          error,
          'The request could not be cancelled.',
        ),
        variant: 'error',
        duration: 5000,
      });
    } finally {
      setIsCancelling(false);
    }
  };
  return (
    <Callout title="Change waiting for approval" variant="warning">
      <div className="flex flex-col gap-3">
        <p>
          {requestTypeLabel[request.type]} with{' '}
          {request.proposedBeneficiaries.length}{' '}
          {request.proposedBeneficiaries.length === 1
            ? 'beneficiary'
            : 'beneficiaries'}
          , sent {formatRequestTime(request.submittedAt)}
          {request.reason ? ` · ${reasonLabel(request.reason)}` : ''}.
        </p>
        <BeneficiaryTable beneficiaries={request.proposedBeneficiaries} />
        <div className="flex flex-wrap gap-2">
          {canCancel ? (
            <Button
              variant="secondary"
              onClick={cancel}
              isLoading={isCancelling}
              loadingText="Cancelling"
            >
              Cancel request
            </Button>
          ) : null}
          {reviewLink ? (
            <Button variant="secondary" asChild>
              <Link
                to={`/beneficiary-requests?request=${encodeURIComponent(request.id)}`}
                className="gap-1"
              >
                Review request
                <RiExternalLinkLine className="size-4" aria-hidden />
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    </Callout>
  );
}

function RequestHistory({
  requests,
}: {
  requests: BeneficiaryRequestRecord[];
}) {
  if (requests.length === 0) return null;
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">
        Change history
      </h3>
      <TableRoot className="mt-3">
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Sent</TableHeaderCell>
              <TableHeaderCell>Type</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Administrator note</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {requests.map((request) => (
              <TableRow key={request.id}>
                <TableCell>{formatRequestTime(request.submittedAt)}</TableCell>
                <TableCell>
                  {requestTypeLabel[request.type]}
                  {request.reason ? (
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {reasonLabel(request.reason)}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge variant={requestStatusVariant[request.status]}>
                    {requestStatusLabel[request.status]}
                  </Badge>
                </TableCell>
                <TableCell className="whitespace-normal">
                  {request.reviewNote ?? '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>
    </Card>
  );
}

export function Beneficiaries({
  member,
  ownProfile,
}: {
  member: Member;
  ownProfile: boolean;
}) {
  const { user, can } = useUser();
  const [beneficiaries, setBeneficiaries] = useState<BeneficiaryRecord[]>();
  const [state, setState] = useState<BeneficiaryState>();
  const [requests, setRequests] = useState<BeneficiaryRequestRecord[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const onError = () =>
      setError('Beneficiaries could not be loaded. Please try again.');
    const unsubscribers = [
      subscribeBeneficiaries(member.member_id, setBeneficiaries, onError),
      subscribeBeneficiaryState(member.member_id, setState, onError),
      subscribeMemberBeneficiaryRequests(
        member.member_id,
        setRequests,
        onError,
      ),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [member.member_id]);

  if (error) {
    return (
      <Callout title="Something went wrong" variant="error" className="mt-6">
        {error}
      </Callout>
    );
  }
  if (!beneficiaries || !state) {
    return (
      <p className="mt-6 text-sm text-gray-500 dark:text-gray-400">
        Loading beneficiaries…
      </p>
    );
  }

  const isSelf = ownProfile || user?.uid === member.member_id;
  const canReview = can('beneficiaries.review');
  const kind = expectedRequestKind(state);
  const pending = requests.find((request) => request.status === 'pending');
  // The backend enforces all of these rules; the UI only hides what would fail.
  const canRequest = isSelf && member.status === 'active' && !pending;
  const canSetInitial = canReview && !isSelf && state.version === 0 && !pending;

  return (
    <div className="mt-6 flex flex-col gap-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">
              Beneficiaries
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {isSelf
                ? 'Changes are reviewed by an administrator. You can make one change each calendar year; further changes need a reason.'
                : 'Approved beneficiaries for this member.'}
            </p>
          </div>
          {canRequest ? (
            <DialogBeneficiaryForm
              mode="request"
              memberId={member.member_id}
              kind={kind}
              current={beneficiaries}
              trigger={
                <Button variant="primary" className="gap-1">
                  {beneficiaries.length ? (
                    <RiEdit2Line className="size-4" aria-hidden />
                  ) : (
                    <RiAddLine className="size-4" aria-hidden />
                  )}
                  {beneficiaries.length
                    ? 'Request change'
                    : 'Add beneficiaries'}
                </Button>
              }
            />
          ) : null}
          {canSetInitial ? (
            <DialogBeneficiaryForm
              mode="initial"
              memberId={member.member_id}
              kind="initial"
              trigger={
                <Button variant="secondary" className="gap-1">
                  <RiAddLine className="size-4" aria-hidden />
                  Set initial beneficiaries
                </Button>
              }
            />
          ) : null}
        </div>
        <div className="mt-4">
          <BeneficiaryTable
            beneficiaries={beneficiaries}
            emptyMessage={
              isSelf
                ? 'You have not recorded any beneficiaries yet.'
                : 'This member has no approved beneficiaries yet.'
            }
          />
        </div>
      </Card>

      {pending ? (
        <PendingRequest
          request={pending}
          canCancel={isSelf}
          reviewLink={canReview && !isSelf}
        />
      ) : null}

      <RequestHistory
        requests={requests.filter((request) => request.status !== 'pending')}
      />
    </div>
  );
}
