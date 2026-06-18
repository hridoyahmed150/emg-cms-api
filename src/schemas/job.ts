import { z } from 'zod';

export const JobStatusSchema = z.enum(['active', 'expired', 'draft']);

export const CreateJobSchema = z.object({
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be kebab-case'),
  title: z.string().min(1),
  type: z.string().min(1), // 'full-time' | 'part-time' | 'contract' (free-form for now)
  location: z.string().min(1),
  posted: z.coerce.date(),
  status: JobStatusSchema.default('active'),
  // Client-specific fields (hybrid). Deep-validated in the service against org customFields.
  meta: z.record(z.string(), z.unknown()).default({}),
});
export type CreateJobInput = z.infer<typeof CreateJobSchema>;

export const UpdateJobSchema = CreateJobSchema.partial();
export type UpdateJobInput = z.infer<typeof UpdateJobSchema>;

export const ListJobsQuerySchema = z.object({
  status: JobStatusSchema.optional(),
  type: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListJobsQuery = z.infer<typeof ListJobsQuerySchema>;
