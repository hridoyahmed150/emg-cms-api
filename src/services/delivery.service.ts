import { Prisma, prisma } from '../lib/prisma';

/**
 * Delivery model = "Publish to site" (Option A): content edits do NOT auto-trigger a
 * site build. A mutation only stamps `config.delivery.lastContentChangeAt` (so the
 * dashboard can show "unpublished changes"). A build runs ONLY when the user clicks
 * Publish → publishNow(), which enqueues ONE SyncJob and stamps lastPublishedAt. This
 * avoids a rebuild-per-save storm when reviews/jobs are added one at a time.
 */

/** Read-modify-write a sub-object of Organization.config (Organization is NOT tenant-scoped). */
async function patchConfig(orgId: number, key: string, patch: Record<string, unknown>): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { config: true } });
  const config: Record<string, unknown> =
    org?.config && typeof org.config === 'object' ? { ...(org.config as Record<string, unknown>) } : {};
  const current: Record<string, unknown> =
    config[key] && typeof config[key] === 'object' ? { ...(config[key] as Record<string, unknown>) } : {};
  config[key] = { ...current, ...patch };
  await prisma.organization.update({
    where: { id: orgId },
    data: { config: config as Prisma.InputJsonValue },
  });
}

/**
 * Record that publishable content changed (no build). Drives the "unpublished changes"
 * indicator: the dashboard compares lastContentChangeAt vs lastPublishedAt.
 */
export async function markContentChanged(orgId: number): Promise<void> {
  await patchConfig(orgId, 'delivery', { lastContentChangeAt: Date.now() });
}

/**
 * Publish now: enqueue ONE delivery job (Astro rebuild / WP cache-bust) for the org and
 * stamp lastPublishedAt. Coalesces with an existing pending job so a double-click (or a
 * burst) collapses into a single build. Must run in the org's tenant context (SyncJob is
 * tenant-scoped).
 */
export async function publishNow(orgId: number): Promise<{ jobId: number }> {
  const scheduledAt = new Date();
  const existing = await prisma.syncJob.findFirst({
    where: { status: 'pending' },
    orderBy: { scheduledAt: 'desc' },
  });
  let jobId: number;
  if (existing) {
    await prisma.syncJob.updateMany({ where: { id: existing.id }, data: { scheduledAt } });
    jobId = existing.id;
  } else {
    const job = await prisma.syncJob.create({
      data: { organizationId: orgId, collection: 'site', status: 'pending', scheduledAt },
    });
    jobId = job.id;
  }
  await patchConfig(orgId, 'delivery', { lastPublishedAt: Date.now() });
  return { jobId };
}
