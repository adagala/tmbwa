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
import { updateMembershipFees } from '@/lib/firebase/firestore';
import { Member } from '@/schemas/member';
import { Badge } from '@/components/Badge';
import { RiEdit2Line } from '@remixicon/react';

export const DialogMembershipFeeUpdate = ({ member }: { member: Member }) => {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);

  return (
    <>
      <div className="flex justify-center">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <RiEdit2Line className="size-5 text-gray-500 hover:text-gray-300" />
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <form
              onSubmit={(event) => {
                setIsLoading(true);
                updateMembershipFees(member.member_id, member)
                  .then(() => {
                    toast({
                      title: 'Success',
                      description: 'Membership fees state updated.',
                      variant: 'success',
                      duration: 3000,
                    });
                    setOpen(false);
                  })
                  .catch(() => {
                    toast({
                      title: 'Error',
                      description: 'Error updating. Try again later.',
                      variant: 'error',
                      duration: 3000,
                    });
                  })
                  .finally(() => {
                    setIsLoading(false);
                  });
                event.preventDefault();
              }}
            >
              <DialogHeader>
                <DialogTitle>Membership Fees</DialogTitle>
                <DialogDescription className="mt-1 text-sm dark:text-gray-300 leading-6">
                  <p>
                    Are you sure you want to update Membership Fees for
                    <br />
                    <span className="font-semibold text-gray-700 dark:text-gray-500">
                      {member.firstname} {member.lastname}{' '}
                    </span>
                    from{' '}
                    <Badge variant={member.isFeesPaid ? 'success' : 'error'}>
                      {member.isFeesPaid ? 'Paid' : 'Not paid'}
                    </Badge>{' '}
                    to{' '}
                    <Badge variant={!member.isFeesPaid ? 'success' : 'error'}>
                      {!member.isFeesPaid ? 'Paid' : 'Not paid'}
                    </Badge>{' '}
                    ?
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
                  variant="primary"
                  isLoading={isLoading}
                >
                  Confirm
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
};
