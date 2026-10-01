import React from 'react';
import { Button } from '@/components/Button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/Dialog';
import { Input } from '@/components/Input';
import { Label } from '@/components/Label';
import { toast } from '@/hooks/useToast';
import { reverseLegacyContributionCorrection } from '@/lib/firebase/financial';

export const DialogReverseLegacyCorrection = ({
  memberId,
  correctionId,
}: {
  memberId: string;
  correctionId: string;
}) => {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reason.trim()) return;
    setLoading(true);
    try {
      await reverseLegacyContributionCorrection({
        memberId,
        correctionId,
        reason: reason.trim(),
      });
      setOpen(false);
      toast({ title: 'Legacy correction reversed', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Reversal failed',
        description: (error as Error).message,
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" className="mt-2 h-7 text-xs">
          Reverse correction
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Reverse legacy correction</DialogTitle>
            <DialogDescription>
              The recorded before-state will be restored only if no later
              financial operation has changed this contribution.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor={`reversal-reason-${correctionId}`}>
              Reversal reason
            </Label>
            <Input
              id={`reversal-reason-${correctionId}`}
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={loading || !reason.trim()}>
              {loading ? 'Reversing…' : 'Confirm reversal'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
