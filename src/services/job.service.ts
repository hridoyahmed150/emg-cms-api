import { Prisma, prisma } from '../lib/prisma';
import { NotFoundError } from '../errors/AppError';
import { validateResourceMeta } from './meta.helper';
import { enqueueDelivery } from './delivery.service';
import type { CreateJobInput, UpdateJobInput, ListJobsQuery } from '../schemas/job';

export async function listJobs(query: ListJobsQuery) {
  const where: Prisma.JobWhereInput = {};
  if (query.status) where.status = query.status;
  if (query.type) where.type = query.type;
  if (query.q) where.title = { contains: query.q, mode: 'insensitive' };

  const [items, total] = await Promise.all([
    prisma.job.findMany({
      where,
      orderBy: { posted: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.job.count({ where }),
  ]);
  return { items, total, page: query.page, limit: query.limit };
}

export async function getJob(id: number) {
  const job = await prisma.job.findFirst({ where: { id } });
  if (!job) throw new NotFoundError('Job not found');
  return job;
}

export async function createJob(orgId: number, input: CreateJobInput) {
  const meta = await validateResourceMeta(orgId, 'jobs', input.meta);
  const job = await prisma.job.create({
    data: {
      organizationId: orgId, // also enforced by the tenant extension
      slug: input.slug,
      title: input.title,
      type: input.type,
      location: input.location,
      posted: input.posted,
      status: input.status,
      meta,
    },
  });
  await enqueueDelivery(orgId, 'jobs');
  return job;
}

export async function updateJob(orgId: number, id: number, input: UpdateJobInput) {
  const data: Prisma.JobUpdateManyMutationInput = {};
  if (input.slug !== undefined) data.slug = input.slug;
  if (input.title !== undefined) data.title = input.title;
  if (input.type !== undefined) data.type = input.type;
  if (input.location !== undefined) data.location = input.location;
  if (input.posted !== undefined) data.posted = input.posted;
  if (input.status !== undefined) data.status = input.status;
  if (input.meta !== undefined) data.meta = await validateResourceMeta(orgId, 'jobs', input.meta);

  const res = await prisma.job.updateMany({ where: { id }, data });
  if (res.count === 0) throw new NotFoundError('Job not found');
  await enqueueDelivery(orgId, 'jobs');
  return getJob(id);
}

export async function deleteJob(orgId: number, id: number) {
  const res = await prisma.job.deleteMany({ where: { id } });
  if (res.count === 0) throw new NotFoundError('Job not found');
  await enqueueDelivery(orgId, 'jobs');
}
