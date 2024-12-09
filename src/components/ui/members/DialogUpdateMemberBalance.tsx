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
import { RiCashLine } from '@remixicon/react';
import { Label } from '@/components/Label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/Select';
import { toast } from '@/hooks/useToast';
import {
  Member,
  member_balance_type,
  MemberBalanceForm,
  memberBalanceFormSchema,
  MemberBalanceType,
} from '@/schemas/member';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { InputErrorMessage } from '../InputErrorMessage';
import { updateMemberBalance } from '@/lib/firebase/firestore';
import useUser from '@/hooks/useUser';
import { Input } from '@/components/Input';

export const DialogUpdateMemberBalance = ({ member }: { member: Member }) => {
  const { user } = useUser();
  const [open, setOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [type, setType] = React.useState<MemberBalanceType>();

  const values: MemberBalanceForm | undefined = undefined;

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
    trigger,
  } = useForm<MemberBalanceForm>({
    resolver: zodResolver(memberBalanceFormSchema),
    values,
  });

  const onSubmit = async (balanceForm: MemberBalanceForm) => {
    setIsLoading(true);

    try {
      const uid = user?.uid;
      if (!uid) return;

      await updateMemberBalance({ uid, balanceForm, member });

      setOpen(false);
      reset();
      setType(undefined);
      toast({
        title: 'Success',
        description: 'Balance updated',
        variant: 'success',
        duration: 3000,
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.message || 'Error updating balance',
        variant: 'error',
        duration: 3000,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="flex justify-center">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              className="h-10 whitespace-nowrap w-full sm:w-auto gap-1"
              variant="primary"
            >
              <>
                <RiCashLine className="size-4" />
                Update <span className="hidden sm:flex"> balance</span>
              </>
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <form onSubmit={handleSubmit(onSubmit)}>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-1.5">
                  {' '}
                  <RiCashLine className="size-7" /> Update {member.firstname}
                  &apos;s balance{' '}
                </DialogTitle>
                <DialogDescription className="mt-1 text-sm leading-6">
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <div className="flex-1 mx-auto space-y-1">
                        <Label htmlFor="year">Type</Label>
                        <Select
                          {...register('type')}
                          onValueChange={(balanceType: MemberBalanceType) => {
                            setType(balanceType);
                            setValue('type', balanceType);
                            trigger('type');
                          }}
                          value={type}
                        >
                          <SelectTrigger id="type" className="capitalize">
                            <SelectValue placeholder="Select Type" />
                          </SelectTrigger>
                          <SelectContent>
                            {member_balance_type.map((balance_type) => (
                              <SelectItem
                                key={balance_type}
                                value={balance_type}
                                className="capitalize"
                              >
                                {balance_type.split('_').join(' ')}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <InputErrorMessage message={errors.type?.message} />
                      </div>
                    </div>
                    <div className="mx-auto space-y-1">
                      <Label htmlFor="amount">Amount</Label>
                      <Input
                        placeholder="Enter contribution amount"
                        id="amount"
                        {...register('amount')}
                        type="number"
                      />
                      <InputErrorMessage message={errors.amount?.message} />
                    </div>
                  </div>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="mt-6">
                <DialogClose asChild>
                  <Button
                    className="mt-2 w-full sm:mt-0 sm:w-fit"
                    variant="secondary"
                    onClick={() => {
                      reset();
                      setType(undefined);
                    }}
                  >
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  className="w-full sm:w-fit"
                  type="submit"
                  isLoading={isLoading}
                  loadingText="Saving"
                >
                  Save
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
};
