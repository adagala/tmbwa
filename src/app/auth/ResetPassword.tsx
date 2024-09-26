import { Label } from '@/components/Label';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { useState } from 'react';
import { RiLock2Line } from '@remixicon/react';
import { Card } from '@/components/Card';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ResetPasswordSchema, resetPasswordSchema } from '@/schemas/user';
import { toast } from '@/hooks/useToast';
import { InputErrorMessage } from '@/components/ui/InputErrorMessage';
import { resetPassword } from '@/lib/firebase/auth';
import { Link } from 'react-router-dom';

export default function ResetPassword() {
  const [isResetting, setIsResetting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordSchema>({
    resolver: zodResolver(resetPasswordSchema),
  });

  const onSubmit = (data: ResetPasswordSchema) => {
    setIsResetting(true);

    resetPassword(data)
      .then(() => {
        toast({
          title: 'Success',
          description: 'Password reset link has been sent to your email',
          variant: 'success',
          duration: 3000,
        });
      })
      .catch(() => {
        toast({
          title: 'Error',
          description: 'Invalid email or password',
          variant: 'error',
          duration: 3000,
        });
      })
      .finally(() => {
        setIsResetting(false);
      });
  };

  return (
    <div className="flex min-h-full flex-1 flex-col justify-center px-4 py-10 lg:px-6">
      <div className="sm:mx-auto sm:w-full sm:max-w-sm">
        <Card className="">
          <div className="space-y-1 my-1">
            <h3 className="text-center text-tremor-title font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
              Reset Password
            </h3>
            <h3 className="text-center text-sm text-gray-500 font-normal">
              A password reset link will be sent to your email.
            </h3>
          </div>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-2">
            <div className="mx-auto max-w-xs space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input
                placeholder="email@example.com"
                id="email"
                {...register('email')}
                type="email"
                hasError={!!errors.email}
              />
              <InputErrorMessage message={errors.email?.message} />
            </div>
            <div className="mx-auto max-w-xs space-y-0.5">
              <Button
                className="w-full mt-2 gap-1"
                type="submit"
                isLoading={isResetting}
                loadingText="Resetting password"
              >
                Reset password
                <RiLock2Line className="h-4 w-4" />
              </Button>
            </div>
            <div className="text-center text-sm text-gray-500 font-normal hover:underline">
              <Link to="/auth/signin">Back to login</Link>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
