import { Prisma, prisma, withTenant } from '../lib/prisma';
import { NotFoundError, ConflictError } from '../errors/AppError';
import type { CreateOrganizationInput, UpdateOrganizationInput } from '../schemas/organization';

// Organization is NOT tenant-scoped; super_admin manages all orgs globally.

export async function listOrganizations() {
  return prisma.organization.findMany({ orderBy: { createdAt: 'desc' } });
}

export async function getOrganization(id: number) {
  const org = await prisma.organization.findUnique({ where: { id } });
  if (!org) throw new NotFoundError('Organization not found');
  return org;
}

export async function createOrganization(input: CreateOrganizationInput) {
  const exists = await prisma.organization.findUnique({ where: { slug: input.slug } });
  if (exists) throw new ConflictError('Organization slug already exists');
  return prisma.organization.create({
    data: {
      slug: input.slug,
      name: input.name,
      deliveryTarget: input.deliveryTarget,
      config: input.config as Prisma.InputJsonValue,
      features: input.features as Prisma.InputJsonValue,
      customFields: input.customFields as Prisma.InputJsonValue,
    },
  });
}

export async function updateOrganization(id: number, input: UpdateOrganizationInput) {
  await getOrganization(id);
  const data: Prisma.OrganizationUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.deliveryTarget !== undefined) data.deliveryTarget = input.deliveryTarget;
  if (input.config !== undefined) data.config = input.config as Prisma.InputJsonValue;
  if (input.features !== undefined) data.features = input.features as Prisma.InputJsonValue;
  if (input.customFields !== undefined) data.customFields = input.customFields as Prisma.InputJsonValue;
  return prisma.organization.update({ where: { id }, data });
}

export async function deleteOrganization(id: number) {
  await getOrganization(id);
  const userCount = await prisma.user.count({ where: { organizationId: id } });
  // Tenant-scoped counts must run inside that org's context.
  const dataCount = await withTenant({ tenantId: id, isSuper: false }, async () => {
    const [jobs, reviews, uploads, syncJobs] = await Promise.all([
      prisma.job.count(),
      prisma.review.count(),
      prisma.upload.count(),
      prisma.syncJob.count(),
    ]);
    return jobs + reviews + uploads + syncJobs;
  });
  if (userCount > 0 || dataCount > 0) {
    throw new ConflictError('Organization has users or data; remove them before deleting');
  }
  await prisma.organization.delete({ where: { id } });
}
