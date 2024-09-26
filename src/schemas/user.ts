import { z } from 'zod';

export const userSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const passwordSchema = z
  .object({
    currentpassword: z.string().min(1, 'Current password is required'),
    password: z.string().min(6, 'Password must be at least 6 characters long'),
    confirmpassword: z.string().min(1, 'Confirm your password'),
  })
  .refine((data) => data.password === data.confirmpassword, {
    message: 'Passwords must match',
    path: ['confirmpassword'], // path of error
  });

export const resetPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export type UserSchema = z.infer<typeof userSchema>;
export type PasswordSchema = z.infer<typeof passwordSchema>;
export type ResetPasswordSchema = z.infer<typeof resetPasswordSchema>;
