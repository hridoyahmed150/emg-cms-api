import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

// Mock the Bitbucket client so reverse-import never hits the network (hoisted above all imports).
vi.mock('../src/delivery/bitbucket.client', () => ({
  readFile: vi.fn(),
  commitFile: vi.fn(),
  commitFiles: vi.fn(),
}));

import { prisma, withTenant } from '../src/lib/prisma';
import { importJobsFromRepo, parseJobsFile } from '../src/services/job.service';
import { readFile } from '../src/delivery/bitbucket.client';

async function reset() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Job","Review","Upload","SyncJob","AuditLog","ApiToken","User","Organization" RESTART IDENTITY CASCADE',
  );
}

async function makeOrg() {
  return prisma.organization.create({
    data: {
      slug: 'eis',
      name: 'EIS',
      deliveryTarget: 'ASTRO_PULL',
      config: { git: { repo: 'eistx', branch: 'main', jobsPath: 'src/data/jobs.json' } },
      features: { jobs: true },
      customFields: {},
    },
  });
}

beforeAll(reset);
afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});
beforeEach(reset);

describe('Jobs reverse-import — parseJobsFile (defensive parser)', () => {
  it('parses a bare array, deriving slug from id (EIS-TX shape)', () => {
    const items = parseJobsFile([
      {
        id: 'irrigation-technician-plano-tx',
        title: 'Irrigation Technician – Plano, TX',
        type: 'full-time',
        location: 'Plano, TX',
        posted: '2025-07-03',
        status: 'expired',
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      slug: 'irrigation-technician-plano-tx',
      title: 'Irrigation Technician – Plano, TX',
      type: 'full-time',
      location: 'Plano, TX',
      status: 'expired',
    });
  });

  it('parses a { jobs: [...] } wrapper and slugifies the title when no slug/id', () => {
    const items = parseJobsFile({ jobs: [{ title: 'Lead Developer', location: 'Dallas, TX' }] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ slug: 'lead-developer', title: 'Lead Developer', type: 'full-time', status: 'active' });
  });

  it('yields 0 jobs from a reviews payload (wrapper OR bare array) pointed at jobsPath', () => {
    expect(parseJobsFile({ source: 'Google', reviews: [{ name: 'Alice', rating: 5, text: 'Great' }] })).toEqual([]);
    // bare array of reviews — `name` is NOT treated as a job title
    expect(parseJobsFile([{ name: 'Alice', rating: 5, text: 'Great' }])).toEqual([]);
  });

  it('returns [] for non-job JSON', () => {
    expect(parseJobsFile(null)).toEqual([]);
    expect(parseJobsFile('nope')).toEqual([]);
    expect(parseJobsFile({ foo: 1 })).toEqual([]);
  });
});

describe('Jobs reverse-import — importJobsFromRepo (repo → CMS)', () => {
  it('imports jobs deduped by slug and is idempotent', async () => {
    const org = await makeOrg();
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify([
        { id: 'irrigation-technician-plano-tx', title: 'Irrigation Technician', type: 'full-time', location: 'Plano, TX', posted: '2025-07-03', status: 'expired' },
        { id: 'lead-dev', title: 'Lead Developer', type: 'full-time', location: 'Dallas, TX', posted: '2026-06-01', status: 'active' },
      ]),
    );

    const first = await withTenant({ tenantId: org.id, isSuper: false }, () => importJobsFromRepo(org.id));
    expect(first).toMatchObject({ received: 2, inserted: 2, skipped: 0 });

    const second = await withTenant({ tenantId: org.id, isSuper: false }, () => importJobsFromRepo(org.id));
    expect(second).toMatchObject({ received: 2, inserted: 0, skipped: 2 }); // slug dedupe

    const count = await withTenant({ tenantId: org.id, isSuper: false }, () => prisma.job.count());
    expect(count).toBe(2);
  });

  it('returns a note (no throw) when the repo has no jobs.json', async () => {
    const org = await makeOrg();
    vi.mocked(readFile).mockResolvedValue(null);
    const res = await withTenant({ tenantId: org.id, isSuper: false }, () => importJobsFromRepo(org.id));
    expect(res.inserted).toBe(0);
    expect(res.note).toContain('nothing to import');
  });

  it('imports 0 jobs (note) when jobsPath points at a reviews.json (the EIS-TX mistake)', async () => {
    const org = await makeOrg();
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ source: 'Google', reviews: [{ name: 'Alice', rating: 5, text: 'Great' }] }),
    );
    const res = await withTenant({ tenantId: org.id, isSuper: false }, () => importJobsFromRepo(org.id));
    expect(res.inserted).toBe(0);
    expect(res.note).toContain('No jobs found');
  });

  it('throws when no jobs file is configured', async () => {
    const org = await prisma.organization.create({
      data: { slug: 'nogit', name: 'NoGit', deliveryTarget: 'ASTRO_PULL', config: {}, features: { jobs: true }, customFields: {} },
    });
    await expect(
      withTenant({ tenantId: org.id, isSuper: false }, () => importJobsFromRepo(org.id)),
    ).rejects.toThrow(/jobs file/i);
  });
});
