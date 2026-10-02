import React from 'react';
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
import { Textarea } from '@/components/Textarea';
import { Label } from '@/components/Label';

export type KcbActionSummaryItem = { label: string; value: string };

/**
 * Controlled confirmation dialog for KCB reconciliation actions. When
 * `reasonField` is set, a non-empty reason is required and passed to
 * `onConfirm`, which is expected to throw on failure so the dialog stays open
 * and shows the error.
 */
export const DialogKcbAction = ({
  open,
  onOpenChange,
  title,
  description,
  summary,
  reasonField,
  confirmLabel,
  loadingText,
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  summary: KcbActionSummaryItem[];
  reasonField?: { id: string; label: string; placeholder?: string };
  confirmLabel: string;
  loadingText: string;
  destructive?: boolean;
  onConfirm: (reason: string) => Promise<void>;
}) => {
  const [reason, setReason] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string>();

  React.useEffect(() => {
    if (!open) return;
    setReason('');
    setError(undefined);
  }, [open]);

  const reasonMissing = Boolean(reasonField) && !reason.trim();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (reasonMissing || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      await onConfirm(reason.trim());
      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'The action did not complete.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!loading) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="mt-1 text-sm leading-6">
              {description}
            </DialogDescription>
          </DialogHeader>
          {summary.length ? (
            <dl className="grid grid-cols-[8rem_1fr] gap-x-2.5 gap-y-2 rounded-md bg-gray-50 p-3 text-sm dark:bg-gray-900">
              {summary.map((item) => (
                <React.Fragment key={item.label}>
                  <dt className="text-gray-500">{item.label}</dt>
                  <dd className="break-words font-medium text-gray-900 dark:text-gray-50">
                    {item.value}
                  </dd>
                </React.Fragment>
              ))}
            </dl>
          ) : null}
          {reasonField ? (
            <div className="space-y-1">
              <Label htmlFor={reasonField.id}>{reasonField.label}</Label>
              <Textarea
                id={reasonField.id}
                required
                autoFocus
                rows={3}
                placeholder={reasonField.placeholder}
                value={reason}
                disabled={loading}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
          ) : null}
          {error ? (
            <Callout title="Could not complete" variant="error" role="alert">
              {error}
            </Callout>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button
                type="button"
                variant="secondary"
                className="mt-2 w-full sm:mt-0 sm:w-fit"
                disabled={loading}
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              variant={destructive ? 'destructive' : 'primary'}
              className="w-full sm:w-fit"
              disabled={reasonMissing}
              isLoading={loading}
              loadingText={loadingText}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
