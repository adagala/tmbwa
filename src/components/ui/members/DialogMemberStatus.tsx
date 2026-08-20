import { useState } from 'react';
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

export function DialogMemberStatus({ member }: { member: Member }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(member.status);
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Change status</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Member lifecycle status</DialogTitle>
          <DialogDescription>
            Only active members receive new monthly charges and retain sign-in
            access. Terminal resigned/deceased statuses cannot be reopened.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="member-status">Status</Label>
          <Select
            value={status}
            onValueChange={(value) => setStatus(value as Member['status'])}
          >
            <SelectTrigger id="member-status" className="capitalize">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {member_status.map((item) => (
                <SelectItem key={item} value={item} className="capitalize">
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button
            disabled={saving || status === member.status}
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
            {saving ? 'Saving…' : 'Apply status'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
