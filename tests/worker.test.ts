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

  it('commits jobs.json (non-draft only) to the repo for a git-configured ASTRO_PULL org', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: { get: () => 'https://bitbucket.org/everydaymediagroup/eistx/commits/abc' },
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const org = await makeOrg('astro-jobs', {
        git: { repo: 'eistx', branch: 'main', jobsPath: 'src/data/jobs.json' },
      });
      await withTenant({ tenantId: org.id, isSuper: false }, () =>
        prisma.job.createMany({
          data: [
            {
              organizationId: org.id,
              slug: 'irrigation-tech',
              title: 'Irrigation Technician',
              type: 'full-time',
              location: 'Plano, TX',
              posted: new Date('2025-07-03'),
              status: 'active',
            },
            {
              organizationId: org.id,
              slug: 'hidden-draft',
              title: 'Hidden Draft Role',
              type: 'full-time',
              location: 'Plano, TX',
              posted: new Date('2025-07-04'),
              status: 'draft',
            },
          ],
        }),
      );
      const job = await enqueue(org.id, new Date(Date.now() - 1000));
      await processDueJobs();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchMock.mock.calls[0] as [string, { body: string }];
      expect(url).toContain('/repositories/everydaymediagroup/eistx/src');
      // URLSearchParams encodes spaces as '+'; decode then restore spaces to assert on content.
      const body = decodeURIComponent(String(opts.body)).replace(/\+/g, ' ');
      expect(body).toContain('src/data/jobs.json');
      expect(body).toContain('Irrigation Technician');
      expect(body).not.toContain('Hidden Draft Role'); // draft excluded from the published jobs.json
      const updated = await getJob(job.id);
      expect(updated?.status).toBe('success');
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
