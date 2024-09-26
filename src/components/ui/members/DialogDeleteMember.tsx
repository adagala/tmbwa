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
import { deleteMember } from '@/lib/firebase/firestore';
import { Member } from '@/schemas/member';
import { useNavigate } from 'react-router-dom';

export const DialogDeleteMember = ({ member }: { member: Member }) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);

  return (
    <>
      <div className="flex justify-center">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              className="h-10 whitespace-nowrap w-full sm:w-auto gap-1"
              variant="destructive"
            >
              Delete
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <form
              onSubmit={() => {
                setIsLoading(true);
                deleteMember(member.member_id)
                  .then(() => {
                    toast({
                      title: 'Success',
                      description: 'Member has been successfully deleted.',
                      variant: 'success',
                      duration: 3000,
                    });
                    navigate('/members');
                  })
                  .catch(() => {
                    toast({
                      title: 'Error',
                      description: 'Error deleting member. Try again later.',
                      variant: 'error',
                      duration: 3000,
                    });
                  })
                  .finally(() => {
                    setIsLoading(false);
                  });
              }}
            >
              <DialogHeader>
                <DialogTitle>Delete member</DialogTitle>
                <DialogDescription className="mt-1 text-sm dark:text-gray-300 leading-6">
                  <p>
                    Are you sure you want to delete{' '}
                    <span className="font-semibold text-gray-700 dark:text-gray-500">
                      {member.firstname} {member.lastname}
                    </span>
                    ? Action is irreversible.
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
                  Delete member
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
};
