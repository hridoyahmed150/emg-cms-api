import { z } from 'zod';
import { PasswordSchema } from './password';

export const RoleSchema = z.enum(['SUPER_ADMIN', 'ADMIN']);

export const CreateUserSchema = z.object({
  email: z.email().transform((s) => s.toLowerCase().trim()),
  name: z.string().min(1),
  role: RoleSchema.default('ADMIN'),
  organizationId: z.coerce.number().int().positive().optional(), // required for non-super
  password: PasswordSchema.optional(), // omitted -> a strong temp password is generated
});
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z.object({
  name: z.string().min(1).optional(),
  role: RoleSchema.optional(),
  password: PasswordSchema.optional(),
  organizationId: z.coerce.number().int().positive().nullable().optional(), // super only
});
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

// Super-admin password reset. Omit `password` -> a strong temp password is generated and
// returned once; supply one to set a specific password. Either way the user must change it
// on next login (mustChangePassword) and all their sessions are invalidated (tokenVersion).
export const ResetPasswordSchema = z.object({
  password: PasswordSchema.optional(),
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;
