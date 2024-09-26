import { PasswordSchema, passwordSchema } from '@/schemas/user';
import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from '@/hooks/useToast';
import { Label } from '@/components/Label';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { InputErrorMessage } from '../InputErrorMessage';
import { reauthenticateUser, updatePassword } from '@/lib/firebase/auth';
import useUser from '@/hooks/useUser';

export function UpdatePassword() {
  const { user } = useUser();
  const [isUpdatingPassword, setIsUpdatingPassword] = React.useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PasswordSchema>({
    resolver: zodResolver(passwordSchema),
  });

  const onSubmit = async (data: PasswordSchema) => {
    if (!user) return;

    try {
      setIsUpdatingPassword(true);
      await reauthenticateUser(user, data.currentpassword);
      await updatePassword(user, data.password);
      toast({
        title: 'Success',
        description: 'Password has been updated',
        variant: 'success',
        duration: 3000,
      });
      reset();
    } catch {
      toast({
        title: 'Error',
        description:
          'Invalid current password. Confirm your password and try again.',
        variant: 'error',
        duration: 3000,
      });
    } finally {
      setIsUpdatingPassword(false);
    }
  };
  return (
    <div className="sm:w-2/3">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 gap-4">
          <div className="col-span-full sm:col-span-3">
            <Label htmlFor="currentpassword">Current password</Label>
            <Input
              placeholder="Enter current password"
              id="currentpassword"
              {...register('currentpassword')}
              type="password"
            />
            <InputErrorMessage message={errors.currentpassword?.message} />
          </div>
          <div className="col-span-full sm:col-span-3">
            <Label htmlFor="password">New password</Label>
            <Input
              placeholder="Enter password"
              id="password"
              {...register('password')}
              type="password"
            />
            <InputErrorMessage message={errors.password?.message} />
          </div>
          <div className="col-span-full sm:col-span-3">
            <Label htmlFor="confirmpassword">Confirm new password</Label>
            <Input
              placeholder="Confirm password"
              id="confirmpassword"
              {...register('confirmpassword')}
              type="password"
            />
            <InputErrorMessage message={errors.confirmpassword?.message} />
          </div>
        </div>
        <div className="col-span-full mt-6 flex justify-end">
          <Button
            className="gap-1"
            isLoading={isUpdatingPassword}
            loadingText="Updating"
          >
            Update password
          </Button>
        </div>
      </form>
    </div>
  );
}
