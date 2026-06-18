import { z } from 'zod';
import { CustomFieldsSchema } from './customFields';

export const DeliveryTargetSchema = z.enum(['ASTRO_PULL', 'WORDPRESS_PULL']);

export const CreateOrganizationSchema = z.object({
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be kebab-case'),
  name: z.string().min(1),
  deliveryTarget: DeliveryTargetSchema,
  // ASTRO_PULL: { buildHookUrl } · WORDPRESS_PULL: { siteUrl, cacheBustUrl?, cacheBustSecretEncrypted? }
  config: z.record(z.string(), z.unknown()).default({}),
  features: z.record(z.string(), z.boolean()).default({}),
  customFields: CustomFieldsSchema.default({}),
});
export type CreateOrganizationInput = z.infer<typeof CreateOrganizationSchema>;

// slug is immutable (stable identifier for consumers); no defaults so absent keys are untouched.
export const UpdateOrganizationSchema = z.object({
  name: z.string().min(1).optional(),
  deliveryTarget: DeliveryTargetSchema.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  features: z.record(z.string(), z.boolean()).optional(),
  customFields: CustomFieldsSchema.optional(),
});
export type UpdateOrganizationInput = z.infer<typeof UpdateOrganizationSchema>;
