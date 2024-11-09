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
import { RiAddLine } from '@remixicon/react';
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
  ContributioForm,
  contributionFormSchema,
  Year,
  Month,
} from '@/schemas/member';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { InputErrorMessage } from '../InputErrorMessage';
import { addContribution } from '@/lib/firebase/firestore';
import { months, years } from '@/lib/utils';

export const DialogAddContribution = ({ member }: { member: Member }) => {
  const [open, setOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [year, setYear] = React.useState<Year>();
  const [month, setMonth] = React.useState<Month>();

  const values: ContributioForm | undefined = undefined;

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
    trigger,
  } = useForm<ContributioForm>({
    resolver: zodResolver(contributionFormSchema),
    values,
  });

  const onSubmit = async (data: ContributioForm) => {
    setIsLoading(true);

    try {
      const month = `${data.year}-${data.month}-01`;
      // const currentMonth = getMonth();

      // if (month > currentMonth) {
      //   toast({
      //     title: 'Warning',
      //     description: 'You can only add past contributions',
      //     variant: 'warning',
      //     duration: 3000,
      //   });
      //   return;
      // }

      await addContribution({ member, month });
      setOpen(false);
      reset();
      setYear(undefined);
      setMonth(undefined);
      toast({
        title: 'Success',
        description: 'Contribution added',
        variant: 'success',
        duration: 3000,
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.message || 'Error adding contribution',
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
                <RiAddLine className="size-4" />
                Add <span className="hidden sm:flex">contribution</span>
              </>
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <form onSubmit={handleSubmit(onSubmit)}>
              <DialogHeader>
                <DialogTitle>Add contribution</DialogTitle>
                <DialogDescription className="mt-1 text-sm leading-6">
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <div className="flex-1 mx-auto space-y-1">
                        <Label htmlFor="year">Year</Label>
                        <Select
                          {...register('year')}
                          onValueChange={(year: Year) => {
                            setYear(year);
                            setValue('year', year);
                            trigger('year');
                          }}
                          value={year}
                        >
                          <SelectTrigger id="year" className="capitalize">
                            <SelectValue placeholder="Select Year" />
                          </SelectTrigger>
                          <SelectContent>
                            {years.map((year) => (
                              <SelectItem
                                key={year}
                                value={year}
                                className="capitalize"
                              >
                                {year}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <InputErrorMessage message={errors.year?.message} />
                      </div>
                      <div className="flex-1 mx-auto space-y-1">
                        <Label htmlFor="month">Month</Label>
                        <Select
                          {...register('month')}
                          onValueChange={(month: Month) => {
                            setMonth(month);
                            setValue('month', month);
                            trigger('month');
                          }}
                          value={month}
                        >
                          <SelectTrigger id="month" className="capitalize">
                            <SelectValue placeholder="Select Month" />
                          </SelectTrigger>
                          <SelectContent>
                            {months.map((month) => (
                              <SelectItem
                                key={month.value}
                                value={month.value}
                                className="capitalize"
                              >
                                {month.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <InputErrorMessage message={errors.month?.message} />
                      </div>
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
                      setYear(undefined);
                      setMonth(undefined);
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
