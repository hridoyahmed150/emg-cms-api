import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { processDueJobs } from '../src/delivery/worker';
import { Prisma, prisma, withTenant } from '../src/lib/prisma';

const SUPER = { tenantId: null, isSuper: true } as const;

async function reset() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Job","Review","Upload","SyncJob","AuditLog","ApiToken","User","Organization" RESTART IDENTITY CASCADE',
  );
}

async function makeOrg(
  slug: string,
  config: Prisma.InputJsonValue,
  deliveryTarget: 'ASTRO_PULL' | 'WORDPRESS_PULL' = 'ASTRO_PULL',
) {
  return prisma.organization.create({
    data: { slug, name: slug, deliveryTarget, config, features: {}, customFields: {} },
  });
}

function enqueue(orgId: number, when: Date) {
  return withTenant({ tenantId: orgId, isSuper: false }, () =>
    prisma.syncJob.create({
      data: { organizationId: orgId, collection: 'jobs', status: 'pending', scheduledAt: when },
    }),
  );
}

const getJob = (id: number) => withTenant(SUPER, () => prisma.syncJob.findFirst({ where: { id } }));
const forcePast = (id: number) =>
  withTenant(SUPER, () =>
    prisma.syncJob.updateMany({ where: { id }, data: { scheduledAt: new Date(Date.now() - 1000) } }),
  );

beforeAll(reset);
afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});
beforeEach(reset);

describe('Delivery worker', () => {
  it('triggers the Astro build hook for a due job and marks success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const org = await makeOrg('astro1', { buildHookUrl: 'https://hook.test/build' });
      const job = await enqueue(org.id, new Date(Date.now() - 1000));
      await processDueJobs();
      expect(fetchMock).toHaveBeenCalledWith(
        'https://hook.test/build',
        expect.objectContaining({ method: 'POST' }),
      );
      const updated = await getJob(job.id);
      expect(updated?.status).toBe('success');
      expect(updated?.attempts).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not trigger a job scheduled in the future', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const org = await makeOrg('astro2', { buildHookUrl: 'https://hook.test/build' });
      await enqueue(org.id, new Date(Date.now() + 60_000));
      await processDueJobs();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('retries on failure then fails after max attempts', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const org = await makeOrg('astro3', { buildHookUrl: 'https://hook.test/build' });
      const job = await enqueue(org.id, new Date(Date.now() - 1000));

      await processDueJobs(); // attempt 1
      let j = await getJob(job.id);
      expect(j?.status).toBe('pending');
      expect(j?.attempts).toBe(1);

      await forcePast(job.id);
      await processDueJobs(); // attempt 2
      j = await getJob(job.id);
      expect(j?.status).toBe('pending');
      expect(j?.attempts).toBe(2);

      await forcePast(job.id);
      await processDueJobs(); // attempt 3 -> failed
      j = await getJob(job.id);
      expect(j?.status).toBe('failed');
      expect(j?.attempts).toBe(3);

      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('WORDPRESS_PULL with no cacheBustUrl succeeds without an HTTP call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      const org = await makeOrg('wp1', {}, 'WORDPRESS_PULL');
      const job = await enqueue(org.id, new Date(Date.now() - 1000));
      await processDueJobs();
      expect(fetchMock).not.toHaveBeenCalled();
      const j = await getJob(job.id);
      expect(j?.status).toBe('success');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
