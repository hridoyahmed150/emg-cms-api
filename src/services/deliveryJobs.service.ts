import { prisma } from '../lib/prisma';
import { NotFoundError } from '../errors/AppError';

/** List recent delivery (sync) jobs for the current tenant. */
export async function listDeliveryJobs(limit = 50) {
  return prisma.syncJob.findMany({ orderBy: { scheduledAt: 'desc' }, take: limit });
}

/** Re-queue a failed delivery job. */
export async function retryDeliveryJob(id: number) {
  const res = await prisma.syncJob.updateMany({
    where: { id, status: 'failed' },
    data: { status: 'pending', scheduledAt: new Date(), error: null, attempts: 0 },
  });
  if (res.count === 0) throw new NotFoundError('No failed delivery job with that id');
}
