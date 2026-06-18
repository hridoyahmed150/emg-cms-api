import { z } from 'zod';

/**
 * Hybrid data-shape: per-org custom field definitions (stored on
 * Organization.customFields) drive dynamic validation of each resource's `meta`.
 */
export const FieldTypeSchema = z.enum(['string', 'number', 'boolean', 'enum', 'url']);
export type FieldType = z.infer<typeof FieldTypeSchema>;

export const FieldDefSchema = z.object({
  key: z.string().min(1).regex(/^[a-zA-Z0-9_]+$/, 'key must be alphanumeric/underscore'),
  label: z.string().min(1),
  type: FieldTypeSchema,
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(), // for type: 'enum'
});
export type FieldDef = z.infer<typeof FieldDefSchema>;

/** Map of collection name -> field definitions, e.g. { jobs: [...], reviews: [...] }. */
export const CustomFieldsSchema = z.record(z.string(), z.array(FieldDefSchema));
export type CustomFields = z.infer<typeof CustomFieldsSchema>;

/**
 * Build a Zod schema validating a resource's `meta` object against its field defs.
 * Unknown keys are stripped (default z.object behavior), so clients can't inject
 * arbitrary data beyond the org's configured fields.
 */
export function buildMetaSchema(defs: FieldDef[]): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  for (const def of defs) {
    let field: z.ZodType;
    switch (def.type) {
      case 'number':
        field = z.number();
        break;
      case 'boolean':
        field = z.boolean();
        break;
      case 'url':
        field = z.url();
        break;
      case 'enum':
        field =
          def.options && def.options.length > 0
            ? z.enum(def.options as [string, ...string[]])
            : z.string();
        break;
      case 'string':
      default:
        field = z.string();
        break;
    }
    shape[def.key] = def.required ? field : field.optional();
  }
  return z.object(shape);
}

/** Safely read a collection's field defs from an org's customFields JSON. */
export function getFieldDefs(customFields: unknown, collection: string): FieldDef[] {
  const parsed = CustomFieldsSchema.safeParse(customFields ?? {});
  if (!parsed.success) return [];
  return parsed.data[collection] ?? [];
}
