import { useEffect, useState } from 'react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Callout } from '@/components/Callout';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/Dialog';
import { Input } from '@/components/Input';
import { Label } from '@/components/Label';
import { toast } from '@/hooks/useToast';
import useUser from '@/hooks/useUser';
import {
  formatRequestTime,
  reasonLabel,
  requestStatusLabel,
  requestStatusVariant,
  requestTypeLabel,
} from '@/lib/beneficiaryDisplay';
import {
  BeneficiaryRecord,
  BeneficiaryRequestRecord,
  approveBeneficiaryChange,
  commandErrorMessage,
  rejectBeneficiaryChange,
  subscribeBeneficiaries,
} from '@/lib/firebase/beneficiaries';
import { InputErrorMessage } from '../InputErrorMessage';
import { BeneficiaryTable } from './BeneficiaryTable';

const MAX_NOTE_LENGTH = 500;

export function DialogBeneficiaryReview({
  request,
  memberName,
  open,
  onOpenChange,
}: {
  request: BeneficiaryRequestRecord;
  memberName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useUser();
  const [current, setCurrent] = useState<BeneficiaryRecord[]>();
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string>();
  const [pendingAction, setPendingAction] = useState<'approve' | 'reject'>();

  useEffect(() => {
    if (!open) return;
    setNote('');
    setNoteError(undefined);
    return subscribeBeneficiaries(request.memberId, setCurrent, () =>
      setCurrent([]),
    );
  }, [open, request.memberId]);

  const isOwnRequest = user?.uid === request.memberId;
  const canReview = request.status === 'pending' && !isOwnRequest;

  const decide = async (action: 'approve' | 'reject') => {
    const trimmed = note.trim();
    if (action === 'reject' && !trimmed) {
      setNoteError('Add a note explaining why the request is not approved.');
      return;
    }
    if (trimmed.length > MAX_NOTE_LENGTH) {
      setNoteError(`Keep the note to ${MAX_NOTE_LENGTH} characters.`);
      return;
    }
    setPendingAction(action);
    try {
      if (action === 'approve') {
        await approveBeneficiaryChange(request.id, trimmed || undefined);
      } else {
        await rejectBeneficiaryChange(request.id, trimmed);
      }
      onOpenChange(false);
      toast({
        title: action === 'approve' ? 'Request approved' : 'Request rejected',
        description: `${memberName} has been notified.`,
        variant: 'success',
        duration: 3000,
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: commandErrorMessage(
          error,
          'The decision could not be saved. Please try again.',
        ),
        variant: 'error',
        duration: 5000,
      });
    } finally {
      setPendingAction(undefined);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {memberName}
            <Badge variant={requestStatusVariant[request.status]}>
              {requestStatusLabel[request.status]}
            </Badge>
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm leading-6">
            {requestTypeLabel[request.type]} sent{' '}
            {formatRequestTime(request.submittedAt)}
            {request.reason ? ` · Reason: ${reasonLabel(request.reason)}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <section>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">
              Current beneficiaries
            </h3>
            <div className="mt-2">
              {current ? (
                <BeneficiaryTable
                  beneficiaries={current}
                  emptyMessage="No approved beneficiaries yet."
                />
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Loading…
                </p>
              )}
            </div>
          </section>
          <section>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">
              {request.status === 'pending' ? 'Proposed' : 'Requested'}{' '}
              beneficiaries
            </h3>
            <div className="mt-2">
              <BeneficiaryTable beneficiaries={request.proposedBeneficiaries} />
            </div>
          </section>
        </div>

        {request.reviewNote ? (
          <Callout
            title="Administrator note"
            variant="neutral"
            className="mt-4"
          >
            {request.reviewNote}
          </Callout>
        ) : null}

        {request.status === 'pending' && isOwnRequest ? (
          <Callout title="Your own request" variant="warning" className="mt-4">
            Another administrator must review changes to your own beneficiaries.
          </Callout>
        ) : null}

        {canReview ? (
          <div className="mt-4 space-y-1">
            <Label htmlFor="review-note">
              Note to the member (required to reject)
            </Label>
            <Input
              id="review-note"
              value={note}
              maxLength={MAX_NOTE_LENGTH}
              onChange={(event) => {
                setNote(event.target.value);
                setNoteError(undefined);
              }}
              hasError={!!noteError}
            />
            <InputErrorMessage message={noteError} />
          </div>
        ) : null}

        <DialogFooter className="mt-6">
          <DialogClose asChild>
            <Button
              className="mt-2 w-full sm:mt-0 sm:w-fit"
              variant="secondary"
            >
              Close
            </Button>
          </DialogClose>
          {canReview ? (
            <>
              <Button
                className="w-full sm:w-fit"
                variant="destructive"
                onClick={() => decide('reject')}
                isLoading={pendingAction === 'reject'}
                disabled={!!pendingAction}
                loadingText="Rejecting"
              >
                Reject
              </Button>
              <Button
                className="w-full sm:w-fit"
                onClick={() => decide('approve')}
                isLoading={pendingAction === 'approve'}
                disabled={!!pendingAction}
                loadingText="Approving"
              >
                Approve
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
