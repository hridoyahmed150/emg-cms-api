import { Prisma, prisma } from '../lib/prisma';
import { ValidationError } from '../errors/AppError';
import { buildMetaSchema, getFieldDefs } from '../schemas/customFields';

/**
 * Deep-validate a resource's hybrid `meta` against the org's custom field
 * definitions. Shared by every resource service (jobs, reviews, …).
 */
export async function validateResourceMeta(
  orgId: number,
  collection: string,
  meta: Record<string, unknown>,
): Promise<Prisma.InputJsonValue> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { customFields: true },
  });
  const defs = getFieldDefs(org?.customFields, collection);
  const result = buildMetaSchema(defs).safeParse(meta);
  if (!result.success) {
    throw new ValidationError(
      'Invalid custom fields (meta)',
      result.error.issues.map((i) => ({ path: `meta.${i.path.join('.')}`, message: i.message })),
    );
  }
  return (result.data ?? {}) as Prisma.InputJsonValue;
}
