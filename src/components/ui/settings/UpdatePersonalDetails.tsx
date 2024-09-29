import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "@/hooks/useToast";
import { Label } from "@/components/Label";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/Select";
import { InputErrorMessage } from "../InputErrorMessage";
import {
  Gender,
  Member,
  OwnMemberForm,
  genders,
  ownMemberFormSchema,
} from "@/schemas/member";
import { updateMember } from "@/lib/firebase/firestore";

export function UpdatePersonalDetails({ member }: { member: Member }) {
  const [isUpdating, setIsUpdating] = React.useState(false);
  const [gender, setGender] = React.useState<Gender>();

  const values: OwnMemberForm = {
    firstname: member.firstname,
    lastname: member.lastname,
    gender: member.gender,
    membernumber: member.membernumber,
    win: member.win,
    phonenumber: member.phonenumber,
  };

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    trigger,
    formState: { errors },
  } = useForm<OwnMemberForm>({
    resolver: zodResolver(ownMemberFormSchema),
    values,
  });

  const onSubmit = (data: OwnMemberForm) => {
    setIsUpdating(true);
    updateMember(member.member_id, data)
      .then(() => {
        console.log(data);
        toast({
          title: "Success",
          description: "Profile has been updated",
          variant: "success",
          duration: 3000,
        });
        reset();
      })
      .catch(() => {
        toast({
          title: "Error",
          description: "Unable to update profile",
          variant: "error",
          duration: 3000,
        });
      })
      .finally(() => {
        setIsUpdating(false);
      });
  };

  return (
    <div className="">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
          <div className="col-span-full sm:col-span-3">
            <Label htmlFor="email">First name</Label>
            <Input
              placeholder="Enter first name"
              id="firstname"
              {...register("firstname")}
              type="text"
            />
            <InputErrorMessage message={errors.firstname?.message} />
          </div>
          <div className="col-span-full sm:col-span-3">
            <Label htmlFor="email">Last name</Label>
            <Input
              placeholder="Enter last name"
              id="lastname"
              {...register("lastname")}
              type="text"
            />
            <InputErrorMessage message={errors.lastname?.message} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
          <div className="col-span-full sm:col-span-3">
            <Label htmlFor="membernumber">Admission number</Label>
            <Input
              placeholder="Enter P105"
              id="membernumber"
              {...register("membernumber")}
              type="text"
            />
            <InputErrorMessage message={errors.membernumber?.message} />
          </div>
          <div className="col-span-full sm:col-span-3">
            <Label htmlFor="gender">Gender</Label>
            <Select
              {...register("gender")}
              onValueChange={(gender: Gender) => {
                setGender(gender);
                setValue("gender", gender);
                trigger("gender");
              }}
              value={gender}
              defaultValue={member.gender}
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
          <div className="col-span-full sm:col-span-3">
            <Label htmlFor="win">Welfare identication number</Label>
            <Input
              placeholder="Enter WIN number"
              id="win"
              {...register("win")}
              type="text"
            />
            <InputErrorMessage message={errors.win?.message} />
          </div>
        </div>
        <div className="col-span-full mt-6 flex justify-end">
          <Button
            className="gap-1"
            isLoading={isUpdating}
            loadingText="Updating"
          >
            Update Profile
          </Button>
        </div>
      </form>
    </div>
  );
}
