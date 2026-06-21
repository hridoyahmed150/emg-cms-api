import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Role } from '@prisma/client';
import { createApp } from '../src/server';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/password';
import { signAccessToken } from '../src/lib/jwt';

const app = createApp();

async function reset() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Job","Review","Upload","SyncJob","AuditLog","ApiToken","User","Organization" RESTART IDENTITY CASCADE',
  );
}

async function makeOrgWithAdmin(slug: string, features: Record<string, boolean>) {
  const org = await prisma.organization.create({
    data: { slug, name: slug, deliveryTarget: 'ASTRO_PULL', config: {}, features, customFields: {} },
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

beforeAll(reset);
afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});
beforeEach(reset);

describe('Per-org feature gating', () => {
  it('blocks a disabled module (reviews:false → 403) but allows an enabled one', async () => {
    const { token } = await makeOrgWithAdmin('noreviews', { jobs: true, reviews: false });
    const r = await request(app).get('/api/v1/reviews').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(403);
    const j = await request(app).get('/api/v1/jobs').set('Authorization', `Bearer ${token}`);
    expect(j.status).toBe(200);
  });

  it('treats unset features ({}) as enabled (legacy orgs keep working)', async () => {
    const { token } = await makeOrgWithAdmin('legacy', {});
    expect((await request(app).get('/api/v1/reviews').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    expect((await request(app).get('/api/v1/jobs').set('Authorization', `Bearer ${token}`)).status).toBe(200);
  });

  it('blocks writes to a disabled module', async () => {
    const { token } = await makeOrgWithAdmin('nojobs', { jobs: false, reviews: true });
    const res = await request(app)
      .post('/api/v1/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ slug: 'x', title: 'X', type: 'full-time', location: 'Y', posted: '2026-01-01' });
    expect(res.status).toBe(403);
  });
});
