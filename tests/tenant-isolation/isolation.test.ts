import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Role } from '@prisma/client';
import { createApp } from '../../src/server';
import { prisma, withTenant } from '../../src/lib/prisma';
import { hashPassword } from '../../src/lib/password';
import { signAccessToken } from '../../src/lib/jwt';

const app = createApp();

async function reset() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Job","Review","Upload","SyncJob","AuditLog","ApiToken","User","Organization" RESTART IDENTITY CASCADE',
  );
}

async function makeOrgWithAdmin(slug: string) {
  const org = await prisma.organization.create({
    data: { slug, name: slug, deliveryTarget: 'ASTRO_PULL', config: {}, features: {}, customFields: {} },
  });
  const user = await prisma.user.create({
    data: {
      email: `${slug}@test.com`,
      name: `${slug} admin`,
      role: 'ADMIN' as Role,
      passwordHash: await hashPassword('pw'),
      organizationId: org.id,
    },
  });
  const token = signAccessToken({ userId: user.id, role: 'ADMIN' as Role, organizationId: org.id });
  return { org, user, token };
}

function seedJob(orgId: number, slug: string, title: string) {
  return withTenant({ tenantId: orgId, isSuper: false }, () =>
    prisma.job.create({
      data: {
        organizationId: orgId,
        slug,
        title,
        type: 'full-time',
        location: 'X',
        posted: new Date(),
        status: 'active',
        meta: {},
      },
    }),
  );
}

beforeAll(reset);
afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});
beforeEach(reset);

describe('Tenant isolation — HTTP layer (jobs)', () => {
  it('list returns ONLY the requester org jobs', async () => {
    const a = await makeOrgWithAdmin('orga');
    const b = await makeOrgWithAdmin('orgb');
    await seedJob(a.org.id, 'ja', 'A job');
    await seedJob(b.org.id, 'jb', 'B job');

    const res = await request(app).get('/api/v1/jobs').set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].title).toBe('A job');
  });

  it('GET another org job by id returns 404 (never reveals existence)', async () => {
    const a = await makeOrgWithAdmin('orga');
    const b = await makeOrgWithAdmin('orgb');
    const bJob = await seedJob(b.org.id, 'jb', 'B secret job');

    const res = await request(app).get(`/api/v1/jobs/${bJob.id}`).set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(404);
  });

  it('body organizationId injection is IGNORED (job created in caller org)', async () => {
    const a = await makeOrgWithAdmin('orga');
    const b = await makeOrgWithAdmin('orgb');

    const res = await request(app)
      .post('/api/v1/jobs')
      .set('Authorization', `Bearer ${a.token}`)
      .send({
        organizationId: b.org.id, // malicious injection attempt
        slug: 'inject',
        title: 'Injected',
        type: 'full-time',
        location: 'X',
        posted: '2026-01-01',
      });
    expect(res.status).toBe(201);
    expect(res.body.organizationId).toBe(a.org.id);

    // B must have zero jobs
    const bJobs = await withTenant({ tenantId: b.org.id, isSuper: false }, () => prisma.job.count());
    expect(bJobs).toBe(0);
  });

  it('cross-org PATCH and DELETE return 404 and do not mutate', async () => {
    const a = await makeOrgWithAdmin('orga');
    const b = await makeOrgWithAdmin('orgb');
    const bJob = await seedJob(b.org.id, 'jb', 'B job');

    const patch = await request(app)
      .patch(`/api/v1/jobs/${bJob.id}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ title: 'hacked' });
    expect(patch.status).toBe(404);

    const del = await request(app).delete(`/api/v1/jobs/${bJob.id}`).set('Authorization', `Bearer ${a.token}`);
    expect(del.status).toBe(404);

    const stillThere = await withTenant({ tenantId: b.org.id, isSuper: false }, () =>
      prisma.job.findFirst({ where: { id: bJob.id } }),
    );
    expect(stillThere?.title).toBe('B job');
  });
});

describe('Tenant isolation — Prisma extension (defense in depth)', () => {
  it('findFirst is auto-scoped to the active tenant', async () => {
    const a = await makeOrgWithAdmin('orga');
    const b = await makeOrgWithAdmin('orgb');
    await seedJob(a.org.id, 'ja', 'A job');
    await seedJob(b.org.id, 'jb', 'B job');

    const found = await withTenant({ tenantId: a.org.id, isSuper: false }, () =>
      prisma.job.findMany(),
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.title).toBe('A job');
  });

  it('querying a tenant model WITHOUT a context throws', async () => {
    await expect(prisma.job.findMany()).rejects.toThrow(/without a tenant context/);
  });

  it('findUnique is forbidden on tenant models', async () => {
    const a = await makeOrgWithAdmin('orga');
    await expect(
      withTenant({ tenantId: a.org.id, isSuper: false }, () => prisma.job.findUnique({ where: { id: 1 } })),
    ).rejects.toThrow(/not allowed/);
  });

  it('super admin (no org) sees across orgs', async () => {
    const a = await makeOrgWithAdmin('orga');
    const b = await makeOrgWithAdmin('orgb');
    await seedJob(a.org.id, 'ja', 'A job');
    await seedJob(b.org.id, 'jb', 'B job');

    const all = await withTenant({ tenantId: null, isSuper: true }, () => prisma.job.findMany());
    expect(all).toHaveLength(2);
  });
});
