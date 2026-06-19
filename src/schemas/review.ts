import { z } from 'zod';

export const CreateReviewSchema = z.object({
  name: z.string().min(1),
  avatar: z.url().optional(),
  rating: z.coerce.number().int().min(1).max(5),
  text: z.string().min(1),
  time: z.coerce.number().int().nonnegative().optional(), // unix ms; defaults to now in service
  featured: z.boolean().default(false),
  verified: z.boolean().default(true),
  reviewUrl: z.url().optional(),
  // Client-specific fields (hybrid). Deep-validated in the service against org customFields.
  meta: z.record(z.string(), z.unknown()).default({}),
});
export type CreateReviewInput = z.infer<typeof CreateReviewSchema>;

export const UpdateReviewSchema = CreateReviewSchema.partial();
export type UpdateReviewInput = z.infer<typeof UpdateReviewSchema>;

export const ListReviewsQuerySchema = z.object({
  featured: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  minRating: z.coerce.number().int().min(1).max(5).optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListReviewsQuery = z.infer<typeof ListReviewsQuerySchema>;

// Bulk import (manual seed / fallback / bookmarklet output). Lenient on avatar/url
// (external providers give long opaque URLs). `time` accepts a date string or unix ms.
export const ImportReviewItemSchema = z.object({
  name: z.string().min(1),
  rating: z.coerce.number().int().min(1).max(5),
  text: z.string().min(1),
  time: z.union([z.string(), z.number()]).optional(),
  avatar: z.string().optional(),
  reviewUrl: z.string().optional(),
  externalId: z.string().optional(), // provided → dedupe by it; else content-hash in service
});
export type ImportReviewItem = z.infer<typeof ImportReviewItemSchema>;

export const ImportReviewsSchema = z.object({
  reviews: z.array(ImportReviewItemSchema).min(1).max(200),
});
export type ImportReviewsInput = z.infer<typeof ImportReviewsSchema>;
