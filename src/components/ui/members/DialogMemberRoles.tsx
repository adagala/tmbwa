import { useState } from 'react';
import { RiArrowRightLine, RiShieldUserLine } from '@remixicon/react';
import { Button } from '@/components/Button';
import { Callout } from '@/components/Callout';
import { Checkbox } from '@/components/Checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/Dialog';
import { Input } from '@/components/Input';
import { Label } from '@/components/Label';
import { InputErrorMessage } from '../InputErrorMessage';
import { Member } from 'tmbwa-shared/firebase';
import { Role, memberRoles, normalizeRoles, sameRoles } from 'tmbwa-shared';
import { assignMemberRoles } from '@/lib/firebase/financial';
import { toast } from '@/hooks/useToast';
import {
  describeRoles,
  officerRoles,
  roleDescriptions,
  roleLabels,
} from '@/lib/roleDisplay';

// Mirrors MAX_ROLE_REASON_LENGTH in functions/src/members/roles.ts.
const MAX_REASON_LENGTH = 500;

export function DialogMemberRoles({ member }: { member: Member }) {
  const currentRoles = memberRoles(member);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Role[]>(currentRoles);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const nextRoles = normalizeRoles(selected);
  const unchanged = sameRoles(nextRoles, currentRoles);
  const isActive = member.status === 'active';

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setSelected(currentRoles);
      setReason('');
      setReasonError(undefined);
    }
  };

  const toggle = (role: Role, checked: boolean) =>
    setSelected((roles) =>
      checked ? [...roles, role] : roles.filter((item) => item !== role),
    );

  const save = async () => {
    if (!reason.trim()) {
      setReasonError('Give a reason for this change.');
      return;
    }
    setSaving(true);
    try {
      await assignMemberRoles({
        memberId: member.member_id,
        roles: nextRoles,
        reason: reason.trim(),
      });
      toast({
        title: 'Roles updated',
        description: `${member.firstname} ${member.lastname} is now: ${describeRoles(nextRoles)}. They will be signed out of other sessions.`,
        variant: 'success',
      });
      setOpen(false);
    } catch (error) {
      toast({
        title: 'Role update failed',
        description: (error as Error).message,
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="secondary">Manage roles</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl overflow-hidden p-0">
        <DialogHeader className="border-b border-gray-200 bg-gray-50 p-6 dark:border-gray-800 dark:bg-gray-900/50">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-guardsman-red-100 p-2 text-guardsman-red-700 dark:bg-guardsman-red-400/10 dark:text-guardsman-red-400">
              <RiShieldUserLine className="size-5" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <DialogTitle>Roles</DialogTitle>
              <DialogDescription>
                Choose what {member.firstname} {member.lastname} can do. Every
                change is recorded in the audit log.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-5 p-6">
          {!isActive ? (
            <Callout title="Member is not active" variant="warning">
              Roles can only be removed from inactive members, not granted.
            </Callout>
          ) : null}

          <fieldset className="space-y-3">
            <legend className="sr-only">Officer roles</legend>
            {officerRoles.map((role) => {
              const checked = selected.includes(role);
              const disabled = saving || (!isActive && !checked);
              return (
                <div key={role} className="flex items-start gap-3">
                  <Checkbox
                    id={`role-${role}`}
                    className="mt-0.5"
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={(value) => toggle(role, value === true)}
                  />
                  <div className="space-y-0.5">
                    <Label htmlFor={`role-${role}`} disabled={disabled}>
                      {roleLabels[role]}
                    </Label>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {roleDescriptions[role]}
                    </p>
                  </div>
                </div>
              );
            })}
          </fieldset>

          <div className="space-y-1">
            <Label htmlFor="role-reason">Reason for the change</Label>
            <Input
              id="role-reason"
              value={reason}
              maxLength={MAX_REASON_LENGTH}
              disabled={saving}
              onChange={(event) => {
                setReason(event.target.value);
                setReasonError(undefined);
              }}
              hasError={!!reasonError}
            />
            <InputErrorMessage message={reasonError} />
          </div>
        </div>
        <DialogFooter className="border-t border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/50">
          <Button
            variant="secondary"
            disabled={saving}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button disabled={saving || unchanged} onClick={save}>
            {saving ? 'Saving…' : unchanged ? 'Select a change' : 'Apply roles'}
            {!saving ? (
              <RiArrowRightLine className="size-4" aria-hidden="true" />
            ) : null}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
