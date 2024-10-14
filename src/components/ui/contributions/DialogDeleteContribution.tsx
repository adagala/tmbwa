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
import { Contribution, Member } from '@/schemas/member';
import { deleteContribution } from '@/lib/firebase/firestore';

export const DialogDeleteContribution = ({
  contribution,
  member,
}: {
  contribution: Contribution;
  member: Member;
}) => {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <div className="flex justify-center">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              className="h-10 whitespace-nowrap w-full sm:w-auto gap-1"
              variant="primary"
            >
              Delete
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <form
              onSubmit={async (event) => {
                try {
                  setIsLoading(true);
                  await deleteContribution({ contribution, member });
                  toast({
                    title: 'Success',
                    description: 'Contribution deleted.',
                    variant: 'success',
                    duration: 3000,
                  });
                  setOpen(false);
                } catch (error: any) {
                  toast({
                    title: 'Error',
                    description: error?.message || 'Error deleting contribution',
                    variant: 'error',
                    duration: 3000,
                  });
                } finally {
                  setIsLoading(false);
                }

                event.preventDefault();
              }}
            >
              <DialogHeader>
                <DialogTitle>Delete contribution</DialogTitle>
                <DialogDescription className="mt-1 text-sm leading-6">
                  <p>Action is irreversible.</p>
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
                  Delete
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
};
