import { useState } from 'react';
import {
  RiAlertLine,
  RiArrowRightLine,
  RiUserSettingsLine,
} from '@remixicon/react';
import { Button } from '@/components/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/Dialog';
import { Member } from 'tmbwa-shared/firebase';
import { member_status } from 'tmbwa-shared';
import { transitionMemberStatus } from '@/lib/firebase/financial';
import { toast } from '@/hooks/useToast';
import { Label } from '@/components/Label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/Select';
import { MemberStatusBadge } from './MemberStatusBadge';

const terminalStatuses: Member['status'][] = ['resigned', 'deceased'];

export function DialogMemberStatus({ member }: { member: Member }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(member.status);
  const [saving, setSaving] = useState(false);
  const isTerminal = terminalStatuses.includes(member.status);
  const isTerminalSelection = terminalStatuses.includes(status);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) setStatus(member.status);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="secondary">Change status</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl p-0 overflow-hidden">
        <DialogHeader className="border-b border-gray-200 bg-gray-50 p-6 dark:border-gray-800 dark:bg-gray-900/50">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-guardsman-red-100 p-2 text-guardsman-red-700 dark:bg-guardsman-red-400/10 dark:text-guardsman-red-400">
              <RiUserSettingsLine className="size-5" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <DialogTitle>Member lifecycle status</DialogTitle>
              <DialogDescription>
                Control sign-in access and whether this member receives new
                monthly charges.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-5 p-6">
          <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Current status
              </p>
              <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-50">
                {member.firstname} {member.lastname}
              </p>
            </div>
            <MemberStatusBadge status={member.status} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="member-status">New status</Label>
            <Select
              value={status}
              disabled={isTerminal}
              onValueChange={(value) => setStatus(value as Member['status'])}
            >
              <SelectTrigger id="member-status" className="capitalize">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {member_status.map((item) => (
                  <SelectItem
                    key={item}
                    value={item}
                    className="capitalize"
                    disabled={item === member.status}
                  >
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isTerminal || isTerminalSelection ? (
            <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              <RiAlertLine
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <p>
                {isTerminal
                  ? 'This is a terminal status and cannot be changed.'
                  : `Changing the status to ${status} is permanent and cannot be reversed.`}
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Only active members can sign in and receive new monthly charges.
            </p>
          )}
        </div>
        <DialogFooter className="border-t border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/50">
          <Button
            variant="secondary"
            disabled={saving}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            className="bg-guardsman-red-600 text-white hover:bg-guardsman-red-700 disabled:border-gray-300 disabled:bg-gray-100 disabled:text-gray-500 dark:bg-guardsman-red-500 dark:hover:bg-guardsman-red-600 dark:disabled:border-gray-700 dark:disabled:bg-gray-800 dark:disabled:text-gray-500"
            disabled={saving || isTerminal || status === member.status}
            onClick={async () => {
              setSaving(true);
              try {
                await transitionMemberStatus({
                  memberId: member.member_id,
                  status,
                });
                toast({
                  title: 'Status updated',
                  description: `Member is now ${status}.`,
                  variant: 'success',
                });
                setOpen(false);
              } catch (error) {
                toast({
                  title: 'Status update failed',
                  description: (error as Error).message,
                  variant: 'error',
                });
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving
              ? 'Saving…'
              : status === member.status
                ? 'Select a new status'
                : 'Apply status'}
            {!saving ? (
              <RiArrowRightLine className="size-4" aria-hidden="true" />
            ) : null}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
