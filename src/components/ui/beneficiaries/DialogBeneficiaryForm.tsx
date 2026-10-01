import React from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { RiAddLine, RiDeleteBinLine } from '@remixicon/react';
import {
  BENEFICIARY_CHANGE_REASON_LABELS,
  BENEFICIARY_RELATIONSHIP_LABELS,
  Beneficiary,
  BeneficiaryChangeReason,
  MAX_BENEFICIARIES,
  beneficiary_change_reasons,
  beneficiary_relationships,
  beneficiaryChangeReasonSchema,
  beneficiaryListSchema,
  nairobiDateKey,
} from 'tmbwa-shared';
import { Button } from '@/components/Button';
import { Callout } from '@/components/Callout';
import { DatePicker } from '@/components/DatePicker';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/Select';
import { toast } from '@/hooks/useToast';
import { dateFromKey, ExpectedRequestKind } from '@/lib/beneficiaryDisplay';
import { calendarDateValue } from '@/lib/financialReporting';
import {
  commandErrorMessage,
  setInitialBeneficiaries,
  submitBeneficiaryChange,
} from '@/lib/firebase/beneficiaries';
import { InputErrorMessage } from '../InputErrorMessage';

type FormBeneficiary = {
  firstname: string;
  lastname: string;
  relationship: string;
  relationshipOther: string;
  dateOfBirth: string;
  email: string;
  phonenumber: string;
  idnumber: string;
};

type FormValues = {
  beneficiaries: FormBeneficiary[];
  reason: { category: string; text: string };
};

type FormOutput = {
  beneficiaries: Beneficiary[];
  reason?: BeneficiaryChangeReason;
};

const emptyBeneficiary: FormBeneficiary = {
  firstname: '',
  lastname: '',
  relationship: '',
  relationshipOther: '',
  dateOfBirth: '',
  email: '',
  phonenumber: '',
  idnumber: '',
};

const toFormBeneficiary = (beneficiary: Beneficiary): FormBeneficiary => ({
  firstname: beneficiary.firstname,
  lastname: beneficiary.lastname,
  relationship: beneficiary.relationship,
  relationshipOther: beneficiary.relationshipOther ?? '',
  dateOfBirth: beneficiary.dateOfBirth,
  email: beneficiary.email ?? '',
  phonenumber: beneficiary.phonenumber ?? '',
  idnumber: beneficiary.idnumber ?? '',
});

// The shared schemas validate here for feedback; the server validates again.
const formSchema = (reasonRequired: boolean) =>
  z.object({
    beneficiaries: beneficiaryListSchema,
    reason: reasonRequired
      ? beneficiaryChangeReasonSchema
      : z.unknown().transform(() => undefined),
  });

const kindMessage = (
  mode: 'request' | 'initial',
  kind: ExpectedRequestKind,
) => {
  if (mode === 'initial') {
    return 'These beneficiaries are recorded straight away. Later changes must come from the member and be approved.';
  }
  const year = nairobiDateKey(new Date()).slice(0, 4);
  switch (kind) {
    case 'initial':
      return 'An administrator will review your first beneficiaries. This does not use your yearly change.';
    case 'annual':
      return `This uses your one change for ${year}. An administrator will review it before it takes effect.`;
    default:
      return `You have already used your change for ${year}. Choose the reason for this change; an administrator will review it.`;
  }
};

export function DialogBeneficiaryForm({
  mode,
  memberId,
  kind,
  current = [],
  trigger,
}: {
  mode: 'request' | 'initial';
  memberId: string;
  kind: ExpectedRequestKind;
  current?: Beneficiary[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const reasonRequired = mode === 'request' && kind === 'reason_required';

  const defaultValues: FormValues = {
    beneficiaries: current.length
      ? current.map(toFormBeneficiary)
      : [emptyBeneficiary],
    reason: { category: '', text: '' },
  };

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
    watch,
  } = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(formSchema(reasonRequired)),
    defaultValues,
  });
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'beneficiaries',
  });

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) reset(defaultValues);
  };

  const onSubmit = async ({ beneficiaries, reason }: FormOutput) => {
    setIsLoading(true);
    try {
      if (mode === 'initial') {
        await setInitialBeneficiaries(memberId, beneficiaries);
      } else {
        await submitBeneficiaryChange(beneficiaries, reason);
      }
      setOpen(false);
      toast({
        title: 'Success',
        description:
          mode === 'initial'
            ? 'Beneficiaries recorded.'
            : 'Your request was sent to an administrator for review.',
        variant: 'success',
        duration: 4000,
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: commandErrorMessage(
          error,
          'The beneficiaries could not be saved. Please try again.',
        ),
        variant: 'error',
        duration: 5000,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const listError =
    errors.beneficiaries?.root?.message ?? errors.beneficiaries?.message;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>
              {mode === 'initial'
                ? 'Set initial beneficiaries'
                : current.length
                  ? 'Request a beneficiary change'
                  : 'Add your beneficiaries'}
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm leading-6">
              Up to {MAX_BENEFICIARIES} beneficiaries. Email, phone number and
              ID number are optional.
            </DialogDescription>
          </DialogHeader>

          <Callout
            title={mode === 'initial' ? 'Administrator entry' : 'Approval'}
            className="mt-4"
            variant="neutral"
          >
            {kindMessage(mode, kind)}
          </Callout>

          <div className="mt-4 space-y-4">
            {fields.map((field, index) => {
              const fieldErrors = errors.beneficiaries?.[index];
              const relationship = watch(`beneficiaries.${index}.relationship`);
              return (
                <fieldset
                  key={field.id}
                  className="space-y-3 rounded-md border border-gray-200 p-4 dark:border-gray-800"
                >
                  {/* A legend must be the fieldset's first child to name the group. */}
                  <legend className="sr-only">Beneficiary {index + 1}</legend>
                  <div className="flex items-center justify-between">
                    <p
                      aria-hidden="true"
                      className="text-sm font-semibold text-gray-900 dark:text-gray-50"
                    >
                      Beneficiary {index + 1}
                    </p>
                    {fields.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="gap-1 text-xs"
                        onClick={() => remove(index)}
                        aria-label={`Remove beneficiary ${index + 1}`}
                      >
                        <RiDeleteBinLine className="size-4" aria-hidden />
                        Remove
                      </Button>
                    ) : null}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor={`firstname-${index}`}>First name</Label>
                      <Input
                        id={`firstname-${index}`}
                        {...register(`beneficiaries.${index}.firstname`)}
                        hasError={!!fieldErrors?.firstname}
                      />
                      <InputErrorMessage
                        message={fieldErrors?.firstname?.message}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`lastname-${index}`}>Last name</Label>
                      <Input
                        id={`lastname-${index}`}
                        {...register(`beneficiaries.${index}.lastname`)}
                        hasError={!!fieldErrors?.lastname}
                      />
                      <InputErrorMessage
                        message={fieldErrors?.lastname?.message}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`relationship-${index}`}>
                        Relationship
                      </Label>
                      <Select
                        value={relationship || undefined}
                        onValueChange={(value) =>
                          setValue(
                            `beneficiaries.${index}.relationship`,
                            value,
                            { shouldValidate: true },
                          )
                        }
                      >
                        <SelectTrigger
                          id={`relationship-${index}`}
                          hasError={!!fieldErrors?.relationship}
                        >
                          <SelectValue placeholder="Select relationship" />
                        </SelectTrigger>
                        <SelectContent>
                          {beneficiary_relationships.map((value) => (
                            <SelectItem key={value} value={value}>
                              {BENEFICIARY_RELATIONSHIP_LABELS[value]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <InputErrorMessage
                        message={
                          fieldErrors?.relationship
                            ? 'Select a relationship'
                            : undefined
                        }
                      />
                    </div>
                    {relationship === 'other' ? (
                      <div className="space-y-1">
                        <Label htmlFor={`relationshipOther-${index}`}>
                          Describe the relationship
                        </Label>
                        <Input
                          id={`relationshipOther-${index}`}
                          {...register(
                            `beneficiaries.${index}.relationshipOther`,
                          )}
                          hasError={!!fieldErrors?.relationshipOther}
                        />
                        <InputErrorMessage
                          message={fieldErrors?.relationshipOther?.message}
                        />
                      </div>
                    ) : null}
                    <div className="space-y-1">
                      <Label htmlFor={`dateOfBirth-${index}`}>
                        Date of birth
                      </Label>
                      <DatePicker
                        id={`dateOfBirth-${index}`}
                        placeholder="Select date of birth"
                        enableYearNavigation
                        fromYear={1900}
                        toDate={new Date()}
                        value={dateFromKey(
                          watch(`beneficiaries.${index}.dateOfBirth`),
                        )}
                        onChange={(date) =>
                          setValue(
                            `beneficiaries.${index}.dateOfBirth`,
                            calendarDateValue(date),
                            { shouldValidate: true },
                          )
                        }
                        hasError={!!fieldErrors?.dateOfBirth}
                      />
                      <InputErrorMessage
                        message={fieldErrors?.dateOfBirth?.message}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`phonenumber-${index}`}>
                        Phone number (optional)
                      </Label>
                      <Input
                        id={`phonenumber-${index}`}
                        type="tel"
                        placeholder="+254722000000"
                        {...register(`beneficiaries.${index}.phonenumber`)}
                        hasError={!!fieldErrors?.phonenumber}
                      />
                      <InputErrorMessage
                        message={fieldErrors?.phonenumber?.message}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`email-${index}`}>Email (optional)</Label>
                      <Input
                        id={`email-${index}`}
                        type="email"
                        {...register(`beneficiaries.${index}.email`)}
                        hasError={!!fieldErrors?.email}
                      />
                      <InputErrorMessage
                        message={fieldErrors?.email?.message}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`idnumber-${index}`}>
                        ID number (optional)
                      </Label>
                      <Input
                        id={`idnumber-${index}`}
                        placeholder="National ID, passport or birth certificate"
                        {...register(`beneficiaries.${index}.idnumber`)}
                        hasError={!!fieldErrors?.idnumber}
                      />
                      <InputErrorMessage
                        message={fieldErrors?.idnumber?.message}
                      />
                    </div>
                  </div>
                </fieldset>
              );
            })}
            <InputErrorMessage message={listError} />
            {fields.length < MAX_BENEFICIARIES ? (
              <Button
                type="button"
                variant="secondary"
                className="gap-1"
                onClick={() => append(emptyBeneficiary)}
              >
                <RiAddLine className="size-4" aria-hidden />
                Add beneficiary
              </Button>
            ) : null}

            {reasonRequired ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="reason-category">
                    Reason for this change
                  </Label>
                  <Select
                    value={watch('reason.category') || undefined}
                    onValueChange={(value) =>
                      setValue('reason.category', value, {
                        shouldValidate: true,
                      })
                    }
                  >
                    <SelectTrigger
                      id="reason-category"
                      hasError={!!errors.reason?.category}
                    >
                      <SelectValue placeholder="Select reason" />
                    </SelectTrigger>
                    <SelectContent>
                      {beneficiary_change_reasons.map((value) => (
                        <SelectItem key={value} value={value}>
                          {BENEFICIARY_CHANGE_REASON_LABELS[value]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <InputErrorMessage
                    message={
                      errors.reason?.category ? 'Select a reason' : undefined
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="reason-text">
                    Details
                    {watch('reason.category') === 'other' ? '' : ' (optional)'}
                  </Label>
                  <Input
                    id="reason-text"
                    {...register('reason.text')}
                    hasError={!!errors.reason?.text}
                  />
                  <InputErrorMessage message={errors.reason?.text?.message} />
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button
                type="button"
                className="mt-2 w-full sm:mt-0 sm:w-fit"
                variant="secondary"
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
              {mode === 'initial' ? 'Save beneficiaries' : 'Send for approval'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
