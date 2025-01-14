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
import {
  Member,
  genders,
  memberFormSchema,
  member_roles,
  Gender,
  Role,
  MemberForm,
} from '@/schemas/member';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { InputErrorMessage } from '../InputErrorMessage';
import {
  addMember,
  memberEmailExists,
  updateMember,
} from '@/lib/firebase/firestore';
import { Checkbox } from '@/components/Checkbox';

export const DialogMemberForm = ({ member }: { member?: Member }) => {
  const [open, setOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [role, setRole] = React.useState<Role>();
  const [gender, setGender] = React.useState<Gender>();
  const [isFeesPaid, setIsFeesPaid] = React.useState(
    member?.isFeesPaid || false,
  );

  const values: MemberForm | undefined = member
    ? {
        email: member.email,
        firstname: member.firstname,
        gender: member.gender,
        lastname: member.lastname,
        membernumber: member.membernumber,
        win: member.win,
        phonenumber: member.phonenumber,
        role: member.role,
        isFeesPaid: member.isFeesPaid,
      }
    : undefined;

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
    trigger,
  } = useForm<MemberForm>({
    resolver: zodResolver(memberFormSchema),
    values,
  });

  const onSubmit = async (data: MemberForm) => {
    setIsLoading(true);

    try {
      if (!member || (member && member.email !== data.email)) {
        const exists = await memberEmailExists(data.email);
        if (exists) {
          toast({
            title: 'Warning',
            description: `The email ${data.email} already exists.`,
            variant: 'error',
            duration: 3000,
          });
          return;
        }
      }

      if (member) {
        await updateMember(member.member_id, data);
      } else {
        await addMember(data);
      }
      setOpen(false);
      reset();
      toast({
        title: 'Success',
        description: `Member has been successfully ${
          member ? 'updated' : 'added'
        }.`,
        variant: 'success',
        duration: 3000,
      });
    } catch {
      toast({
        title: 'Error',
        description: `Error ${member ? 'updating' : 'adding'} member`,
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
              {member ? (
                'Update'
              ) : (
                <>
                  <RiAddLine className="size-4" />
                  Add <span className="hidden sm:flex">member</span>
                </>
              )}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <form onSubmit={handleSubmit(onSubmit)}>
              <DialogHeader>
                <DialogTitle>
                  {member ? 'Update' : 'Add new'} member
                </DialogTitle>
                <DialogDescription className="mt-1 text-sm leading-6">
                  <div className="space-y-3">
                    <div className="flex gap-1">
                      <div className="flex-1 mx-auto space-y-1">
                        <Label htmlFor="firstname">First name</Label>
                        <Input
                          placeholder="Enter first name"
                          id="firstname"
                          {...register('firstname')}
                          type="text"
                        />
                        <InputErrorMessage
                          message={errors.firstname?.message}
                        />
                      </div>
                      <div className="flex-1 mx-auto space-y-1">
                        <Label htmlFor="lastname">Last name</Label>
                        <Input
                          placeholder="Enter last name"
                          id="lastname"
                          {...register('lastname')}
                          type="text"
                        />
                        <InputErrorMessage message={errors.lastname?.message} />
                      </div>
                    </div>
                    <div className="mx-auto space-y-1">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        placeholder="email@example.com"
                        id="email"
                        {...register('email')}
                        type="email"
                      />
                      <InputErrorMessage message={errors.email?.message} />
                    </div>
                    <div className="mx-auto space-y-1">
                      <Label htmlFor="phonenumber">Phone number</Label>
                      <Input
                        placeholder="+254722000000"
                        id="phonenumber"
                        {...register('phonenumber')}
                        type="tel"
                      />
                      <InputErrorMessage
                        message={errors.phonenumber?.message}
                      />
                    </div>
                    <div className="mx-auto space-y-1">
                      <Label htmlFor="memebernumber">Admission number</Label>
                      <Input
                        placeholder="Enter P105 number"
                        id="memebernumber"
                        {...register('membernumber')}
                        type="text"
                      />
                      <InputErrorMessage
                        message={errors.membernumber?.message}
                      />
                    </div>
                    <div className="mx-auto space-y-1">
                      <Label htmlFor="win">Welfare identification number</Label>
                      <Input
                        placeholder="Enter WIN number"
                        id="win"
                        {...register('win')}
                        type="text"
                      />
                      <InputErrorMessage message={errors.win?.message} />
                    </div>
                    <div className="flex gap-1">
                      <div className="flex-1 mx-auto space-y-1">
                        <Label htmlFor="role">Role</Label>
                        <Select
                          {...register('role')}
                          onValueChange={(role: Role) => {
                            setRole(role);
                            setValue('role', role);
                            trigger('role');
                          }}
                          value={role}
                          defaultValue={member?.role}
                        >
                          <SelectTrigger id="role" className="capitalize">
                            <SelectValue placeholder="Role" />
                          </SelectTrigger>
                          <SelectContent>
                            {member_roles.map((role) => (
                              <SelectItem
                                key={role}
                                value={role}
                                className="capitalize"
                              >
                                {role}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <InputErrorMessage message={errors.role?.message} />
                      </div>
                      <div className="flex-1 mx-auto space-y-1">
                        <Label htmlFor="gender">Gender</Label>
                        <Select
                          {...register('gender')}
                          onValueChange={(gender: Gender) => {
                            setGender(gender);
                            setValue('gender', gender);
                            trigger('gender');
                          }}
                          value={gender}
                          defaultValue={member?.gender}
                        >
                          <SelectTrigger id="gender" className="capitalize">
                            <SelectValue placeholder="Select gender" />
                          </SelectTrigger>
                          <SelectContent>
                            {genders.map((gender) => (
                              <SelectItem
                                key={gender}
                                value={gender}
                                className="capitalize"
                              >
                                {gender}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <InputErrorMessage message={errors.gender?.message} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="isFeesPaid"
                          checked={isFeesPaid}
                          onCheckedChange={() => {
                            setIsFeesPaid(!isFeesPaid);
                            setValue('isFeesPaid', !isFeesPaid);
                          }}
                        />
                        <Label htmlFor="isFeesPaid">
                          Has paid membership fees?
                        </Label>
                      </div>
                      <InputErrorMessage message={errors.isFeesPaid?.message} />
                    </div>
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
                  loadingText={member ? 'Updating' : 'Adding'}
                >
                  {member ? 'Update' : 'Add'} member
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
};
