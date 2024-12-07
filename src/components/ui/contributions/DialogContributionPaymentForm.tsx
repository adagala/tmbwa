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
import { Contribution, Payment, PaymentForm, PaymentTypeEnum } from '@/schemas/member';
import { toast } from '@/hooks/useToast';
import { DatePicker } from '@/components/DatePicker';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { paymentFormSchema } from '@/schemas/member';
import { InputErrorMessage } from '../InputErrorMessage';
import { RiAddLine, RiErrorWarningFill } from '@remixicon/react';
import { addPayment } from '@/lib/firebase/firestore';
import { Callout } from '@/components/Callout';
import useUser from '@/hooks/useUser';

export const DialogContributionPaymentForm = ({
  contribution,
}: {
  contribution: Contribution;
}) => {
  const { user } = useUser();
  const [open, setOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
    trigger,
    watch,
  } = useForm<PaymentForm>({
    resolver: zodResolver(paymentFormSchema),
  });

  const onSubmit = (data: PaymentForm) => {
    if (!contribution || !user?.uid) {
      setIsLoading(false);
      return;
    }

    const payment: Payment = {
      amount: data.amount,
      contribution_id: contribution.contribution_id,
      firstname: contribution.firstname,
      lastname: contribution.lastname,
      member_id: contribution.member_id,
      paymentdate: data.paymentdate,
      referencenumber: data.referencenumber,
      payment_id: '',
      contribution_amount: data.amount,
      action_by: user.uid,
      payment_type: PaymentTypeEnum.Enum.contribution,
    };
    setIsLoading(true);
    addPayment({ contribution, payment })
      .then(() => {
        setOpen(false);
        reset();
        toast({
          title: 'Success',
          description: 'Payment successfully added.',
          variant: 'success',
          duration: 3000,
        });
      })
      .catch(() => {
        toast({
          title: 'Error',
          description: 'Error adding payment',
          variant: 'error',
          duration: 3000,
        });
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  return (
    <>
      <div className="flex justify-center">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              className="h-10 whitespace-nowrap w-full sm:w-auto gap-1 text-guardsman-red-500"
              variant="ghost"
            >
              <RiAddLine className="size-4" />
              Add payment
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <form onSubmit={handleSubmit(onSubmit)}>
              <DialogHeader>
                <DialogTitle>Add payment</DialogTitle>
                <DialogDescription className="mt-1 text-sm leading-6">
                  <div className="space-y-3">
                    <div className="mx-auto space-y-1">
                      <Label htmlFor="contributiondate">Payment date</Label>
                      <DatePicker
                        onChange={(value) => {
                          if (value) {
                            setValue('paymentdate', value);
                            trigger('paymentdate');
                          }
                        }}
                        toDate={new Date()}
                      />
                      <InputErrorMessage
                        message={errors.paymentdate?.message}
                      />
                    </div>
                    <div className="mx-auto space-y-1">
                      <Label htmlFor="referencenumber">Reference number</Label>
                      <Input
                        placeholder="Enter reference number"
                        id="referencenumber"
                        {...register('referencenumber')}
                        type="text"
                      />
                      <InputErrorMessage
                        message={errors.referencenumber?.message}
                      />
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
                    {watch('amount') > contribution?.balance && (
                      <Callout
                        variant="warning"
                        title="Warning"
                        icon={RiErrorWarningFill}
                      >
                        <div>
                          Excess of{' '}
                          <span className="font-bold">
                            {watch('amount') - contribution?.balance}
                          </span>{' '}
                          will be credited to {contribution.firstname}&apos;s
                          account.
                        </div>
                        <div>
                          Maximum amount required for{' '}
                          {new Date(contribution.month).toLocaleDateString(
                            'en-US',
                            {
                              year: 'numeric',
                              month: 'long',
                            },
                          )}{' '}
                          is{' '}
                          <span className="font-bold">
                            {contribution.balance}
                          </span>
                        </div>
                      </Callout>
                    )}
                  </div>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="mt-6">
                <DialogClose asChild>
                  <Button
                    className="mt-2 w-full sm:mt-0 sm:w-fit"
                    variant="secondary"
                    onClick={() => reset()}
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
