import cron from 'node-cron';
import type { Organization } from '@prisma/client';
import { prisma, withTenant } from '../lib/prisma';
import { logger } from '../lib/logger';
import { triggerAstroBuild } from './cloudcannon.client';
import { triggerWordpressCacheBust } from './wordpress.client';

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [60_000, 300_000, 1_800_000]; // 1m, 5m, 30m
const STUCK_MS = 5 * 60_000; // running > 5m -> reset to pending
const SUPER = { tenantId: null, isSuper: true } as const;

/** Route a sync job to the right delivery target. */
async function dispatch(org: Organization): Promise<string> {
  const config = (org.config ?? {}) as Record<string, unknown>;
  if (org.deliveryTarget === 'ASTRO_PULL') {
    const url = config.buildHookUrl;
    // CloudCannon has no tokenless build webhook — those sites rebuild on git push,
    // a scheduled build, or a manual Rebuild. With no hook, Publish is a clean no-op
    // (mirrors the optional WordPress cache-bust below) rather than a failing job.
    if (typeof url !== 'string' || !url) return 'no buildHookUrl (CloudCannon build via push/schedule/manual)';
    return triggerAstroBuild(url);
  }
  // WORDPRESS_PULL — cache-bust is optional (plugin TTL keeps things fresh otherwise).
  const url = config.cacheBustUrl;
  if (typeof url !== 'string' || !url) return 'no cacheBustUrl (plugin TTL handles freshness)';
  const secret = typeof config.cacheBustSecretEncrypted === 'string' ? config.cacheBustSecretEncrypted : null;
  return triggerWordpressCacheBust(url, secret);
}

async function processJob(jobId: number): Promise<void> {
  // Atomically claim the job (pending -> running, attempts++).
  const claim = await prisma.syncJob.updateMany({
    where: { id: jobId, status: 'pending' },
    data: { status: 'running', startedAt: new Date(), attempts: { increment: 1 } },
  });
  if (claim.count === 0) return;

  const job = await prisma.syncJob.findFirst({ where: { id: jobId } });
  if (!job) return;
  const org = await prisma.organization.findUnique({ where: { id: job.organizationId } });
  if (!org) {
    await prisma.syncJob.updateMany({
      where: { id: jobId },
      data: { status: 'failed', finishedAt: new Date(), error: 'organization not found' },
    });
    return;
  }

  try {
    const result = await dispatch(org);
    await prisma.syncJob.updateMany({
      where: { id: jobId },
      data: { status: 'success', finishedAt: new Date(), result, error: null },
    });
    logger.info({ jobId, org: org.slug, collection: job.collection, result }, 'delivery success');
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (job.attempts >= MAX_ATTEMPTS) {
      await prisma.syncJob.updateMany({
        where: { id: jobId },
        data: { status: 'failed', finishedAt: new Date(), error },
      });
      logger.error({ jobId, org: org.slug, error }, 'delivery failed (max attempts reached)');
    } else {
      const backoff = BACKOFF_MS[job.attempts - 1] ?? 60_000;
      await prisma.syncJob.updateMany({
        where: { id: jobId },
        data: { status: 'pending', scheduledAt: new Date(Date.now() + backoff), error },
      });
      logger.warn({ jobId, org: org.slug, error, retryInMs: backoff }, 'delivery retry scheduled');
    }
  }
}

/** Process all due pending jobs (also resets stuck 'running' jobs). Exported for tests. */
export async function processDueJobs(): Promise<void> {
  await withTenant(SUPER, async () => {
    await prisma.syncJob.updateMany({
      where: { status: 'running', startedAt: { lt: new Date(Date.now() - STUCK_MS) } },
      data: { status: 'pending' },
    });
    const due = await prisma.syncJob.findMany({
      where: { status: 'pending', scheduledAt: { lte: new Date() } },
      orderBy: { scheduledAt: 'asc' },
      take: 25,
    });
    for (const job of due) {
      await processJob(job.id);
    }
  });
}

let task: ReturnType<typeof cron.schedule> | null = null;

export function startDeliveryWorker(): void {
  if (task) return;
  task = cron.schedule('*/5 * * * * *', () => {
    processDueJobs().catch((e) => logger.error({ err: e }, 'delivery worker tick error'));
  });
  logger.info('Delivery worker started (every 5s)');
}
