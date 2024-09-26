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
import { useToast } from '@/hooks/useToast';
import { deletePayment } from '@/lib/firebase/firestore';
import { Contribution, Payment } from '@/schemas/member';
import { getMonth } from '@/lib/utils';

export const DialogDeleteContributionPayment = ({
  contribution,
  payment,
}: {
  contribution: Contribution;
  payment: Payment;
}) => {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);

  const deleteContributionPayment = () => {
    setIsLoading(true);
    deletePayment({ contribution, payment })
      .then(() => {
        setIsLoading(false);
        setOpen(false);
        toast({
          title: 'Success',
          description: 'Payment deleted.',
          variant: 'success',
          duration: 3000,
        });
      })
      .catch(() => {
        toast({
          title: 'Error',
          description: 'Error deleting payment.',
          variant: 'error',
          duration: 3000,
        });
      })
      .finally(() => setIsLoading(false));
  };

  const isCurrentMonth = getMonth() === contribution.month;

  return (
    <>
      <div className="flex justify-center">
        <Dialog
          open={open}
          onOpenChange={(_open) => {
            if (!isCurrentMonth) return;
            setOpen(_open);
          }}
        >
          <DialogTrigger asChild>
            <Button
              className={`absolute top-0 right-0 ${isCurrentMonth ? 'text-red-500' : 'text-gray-500 hover:cursor-not-allowed'}`}
              type="button"
              variant="ghost"
            >
              Delete
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <form
              onSubmit={(event) => {
                deleteContributionPayment();
                event.preventDefault();
              }}
            >
              <DialogHeader>
                <DialogTitle>Delete payment</DialogTitle>
                <DialogDescription className="mt-1 text-sm leading-6">
                  <p>
                    Are you sure you want to delete this payment? Action is
                    irreversible.
                  </p>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="mt-6">
                <DialogClose asChild>
                  <Button
                    className="mt-2 w-full sm:mt-0 sm:w-fit"
                    variant="secondary"
                  >
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  className="w-full sm:w-fit"
                  type="submit"
                  variant="destructive"
                  isLoading={isLoading}
                  loadingText="Deleting"
                >
                  Delete payment
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
};
