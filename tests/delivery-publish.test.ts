import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Role } from '@prisma/client';
import { createApp } from '../src/server';
import { prisma, withTenant } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/password';
import { signAccessToken } from '../src/lib/jwt';

const app = createApp();

async function reset() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Job","Review","Upload","SyncJob","AuditLog","ApiToken","User","Organization" RESTART IDENTITY CASCADE',
  );
}

async function makeOrgWithAdmin(slug = 'pubco') {
  const org = await prisma.organization.create({
    data: { slug, name: slug, deliveryTarget: 'ASTRO_PULL', config: {}, features: {}, customFields: {} },
  });
  const user = await prisma.user.create({
    data: {
      email: `${slug}@test.com`,
      name: 'A',
      role: 'ADMIN' as Role,
      passwordHash: await hashPassword('StrongPass123!'),
      organizationId: org.id,
    },
  });
  const token = signAccessToken({ userId: user.id, role: 'ADMIN' as Role, organizationId: org.id });
  return { org, token };
}

function syncCount(orgId: number) {
  return withTenant({ tenantId: orgId, isSuper: false }, () => prisma.syncJob.count());
}

async function deliveryCfg(orgId: number): Promise<{ lastContentChangeAt?: number; lastPublishedAt?: number }> {
  const o = await prisma.organization.findUnique({ where: { id: orgId }, select: { config: true } });
  const c = (o?.config ?? {}) as Record<string, unknown>;
  const d = c.delivery;
  return (d && typeof d === 'object' ? d : {}) as { lastContentChangeAt?: number; lastPublishedAt?: number };
}

beforeAll(reset);
afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});
beforeEach(reset);

describe('Publish-on-demand delivery (no auto-build)', () => {
  it('creating a review does NOT create a delivery job, but marks content changed', async () => {
    const { org, token } = await makeOrgWithAdmin();
    const res = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X', rating: 5, text: 'great service' });
    expect(res.status).toBe(201);

    expect(await syncCount(org.id)).toBe(0); // no auto build on save
    const cfg = await deliveryCfg(org.id);
    expect(cfg.lastContentChangeAt).toBeGreaterThan(0);
    expect(cfg.lastPublishedAt).toBeUndefined();
  });

  it('POST /delivery-jobs/publish enqueues ONE job, stamps lastPublishedAt, and coalesces', async () => {
    const { org, token } = await makeOrgWithAdmin();
    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X', rating: 5, text: 'g' });

    const pub = await request(app).post('/api/v1/delivery-jobs/publish').set('Authorization', `Bearer ${token}`);
    expect(pub.status).toBe(200);
    expect(await syncCount(org.id)).toBe(1);

    // A second publish while one is still pending coalesces — no second build.
    await request(app).post('/api/v1/delivery-jobs/publish').set('Authorization', `Bearer ${token}`);
    expect(await syncCount(org.id)).toBe(1);

    const cfg = await deliveryCfg(org.id);
    expect(cfg.lastPublishedAt).toBeGreaterThan(0);
  });
});
