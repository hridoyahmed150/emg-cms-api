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
