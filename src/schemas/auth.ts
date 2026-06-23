import { z } from 'zod';
import { PasswordSchema } from './password';

export const LoginSchema = z.object({
  email: z.email().transform((s) => s.toLowerCase().trim()),
  password: z.string().min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof LoginSchema>;

// Self-service password change: verify the current password, then set a new one
// (same strength rules as everywhere else, via PasswordSchema).
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: PasswordSchema,
});

export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
