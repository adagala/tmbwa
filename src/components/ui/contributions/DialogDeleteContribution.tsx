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
import { Contribution } from '@/schemas/member';

const wait = () => new Promise((resolve) => setTimeout(resolve, 1000));

export const DialogDeleteContribution = ({
  contribution,
  open,
  setOpen,
  handleDeleteContribution,
}: {
  open: boolean;
  contribution?: Contribution;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleDeleteContribution: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = React.useState(false);

  return (
    <>
      <div className="flex justify-center">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild></DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <form
              onSubmit={(event) => {
                setIsLoading(true);
                wait().then(() => {
                  setIsLoading(false);
                  setOpen(false);
                  toast({
                    title: 'Success',
                    description: 'Contribution has been successfully deleted.',
                    variant: 'success',
                    duration: 3000,
                  });
                  handleDeleteContribution(false);
                });
                event.preventDefault();
              }}
            >
              <DialogHeader>
                <DialogTitle>Delete contribution</DialogTitle>
                <DialogDescription className="mt-1 text-sm leading-6">
                  <p>
                    Are you sure you want to delete this contribution for $
                    {contribution?.firstname}? Action is irreversible.
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
                  Delete contribution
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
};
