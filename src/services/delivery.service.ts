import { prisma } from '../lib/prisma';

const DEBOUNCE_MS = 10_000;

/**
 * Enqueue a debounced delivery trigger (rebuild / cache-bust) for a collection
 * in the current tenant. If a pending job already exists for this collection,
 * just push its scheduledAt forward. Runs inside the request's tenant context,
 * so SyncJob queries are auto org-scoped.
 */
export async function enqueueDelivery(orgId: number, collection: string): Promise<void> {
  const scheduledAt = new Date(Date.now() + DEBOUNCE_MS);
  const existing = await prisma.syncJob.findFirst({
    where: { collection, status: 'pending' },
    orderBy: { scheduledAt: 'desc' },
  });
  if (existing) {
    await prisma.syncJob.updateMany({ where: { id: existing.id }, data: { scheduledAt } });
    return;
  }
  await prisma.syncJob.create({
    data: { organizationId: orgId, collection, status: 'pending', scheduledAt },
  });
}
