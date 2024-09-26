import { Label } from '@/components/Label';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { useState } from 'react';
import { RiLoginCircleLine } from '@remixicon/react';
import { Card } from '@/components/Card';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { UserSchema, userSchema } from '@/schemas/user';
import { toast } from '@/hooks/useToast';
import { InputErrorMessage } from '@/components/ui/InputErrorMessage';
import { signInWithEmailAndPassword } from '@/lib/firebase/auth';
import { Link, useNavigate } from 'react-router-dom';

export default function LogIn() {
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<UserSchema>({
    resolver: zodResolver(userSchema),
  });

  const onSubmit = (data: UserSchema) => {
    setIsLoggingIn(true);

    signInWithEmailAndPassword(data)
      .then(() => {
        navigate('/overview');
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
        setIsLoggingIn(false);
      });
  };

  const [isLogginIn, setIsLoggingIn] = useState(false);
  return (
    <div className="flex min-h-full flex-1 flex-col justify-center px-4 py-10 lg:px-6">
      <div className="sm:mx-auto sm:w-full sm:max-w-sm">
        <Card className="">
          <h3 className="text-center text-tremor-title font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
            Log In
          </h3>
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
            <div className="mx-auto max-w-xs space-y-1">
              <Label htmlFor="password">Password</Label>
              <Input
                placeholder="Enter password"
                id="password"
                {...register('password')}
                type="password"
                hasError={!!errors.password}
              />
              <InputErrorMessage message={errors.password?.message} />
            </div>
            <div className="mx-auto max-w-xs space-y-0.5">
              <Button
                className="w-full mt-2 gap-1"
                type="submit"
                isLoading={isLogginIn}
                loadingText="Signing in"
              >
                Sign In
                <RiLoginCircleLine className="h-4 w-4" />
              </Button>
            </div>
            <div className="text-center text-sm text-gray-500 font-normal hover:underline hover:text-gray-700">
              <Link to="/auth/reset-password">Reset password</Link>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
