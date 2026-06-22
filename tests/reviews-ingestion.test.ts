import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Role } from '@prisma/client';
import { createApp } from '../src/server';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/password';
import { signAccessToken } from '../src/lib/jwt';
import { generateConsumerToken } from '../src/lib/apiToken';

const app = createApp();

async function reset() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Job","Review","Upload","SyncJob","AuditLog","ApiToken","User","Organization" RESTART IDENTITY CASCADE',
  );
}

async function makeOrg() {
  const org = await prisma.organization.create({
    data: { slug: 'eis', name: 'EIS', deliveryTarget: 'ASTRO_PULL', config: {}, features: {}, customFields: {} },
  });
  const user = await prisma.user.create({
    data: {
      email: 'admin@eis.com',
      name: 'EIS admin',
      role: 'ADMIN' as Role,
      passwordHash: await hashPassword('pw'),
      organizationId: org.id,
    },
  });
  const token = signAccessToken({ userId: user.id, role: 'ADMIN' as Role, organizationId: org.id });
  const consumer = generateConsumerToken();
  await prisma.apiToken.create({
    data: { type: 'CONSUMER', organizationId: org.id, name: 'astro', tokenHash: consumer.hash, scopes: ['reviews:read'] },
  });
  return { org, token, consumerToken: consumer.plaintext };
}

// Two 5★ (newest = Bob) + one 4★ (must be excluded from the public 5★ feed).
const sample = [
  { name: 'Alice', rating: 5, text: 'Great service', time: '2026-06-10', externalId: 'g1' },
  { name: 'Bob', rating: 5, text: 'Awesome team', time: '2026-06-12', externalId: 'g2' },
  { name: 'Carol', rating: 4, text: 'Pretty good', time: '2026-06-11', externalId: 'g3' },
];

const importReviews = (token: string, reviews: unknown[]) =>
  request(app).post('/api/v1/reviews/import').set('Authorization', `Bearer ${token}`).send({ reviews });

beforeAll(reset);
afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});
beforeEach(reset);

describe('Reviews ingestion — import + dedupe', () => {
  it('imports all rows, then dedupes an identical re-import', async () => {
    const { token } = await makeOrg();

    const r1 = await importReviews(token, sample);
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ received: 3, inserted: 3, skipped: 0 });

    const r2 = await importReviews(token, sample);
    expect(r2.status).toBe(200);
    expect(r2.body).toMatchObject({ received: 3, inserted: 0, skipped: 3 });
  });

  it('dedupes manual rows without externalId by content hash', async () => {
    const { token } = await makeOrg();
    const noId = [{ name: 'Dan', rating: 5, text: 'Top notch', time: '2026-06-01' }];
    expect((await importReviews(token, noId)).body.inserted).toBe(1);
    expect((await importReviews(token, noId)).body.inserted).toBe(0); // same content → skipped
  });

  it('stamps config.reviews.lastRefreshedAt', async () => {
    const { org, token } = await makeOrg();
    await importReviews(token, sample);
    const fresh = await prisma.organization.findUnique({ where: { id: org.id }, select: { config: true } });
    const cfg = fresh!.config as { reviews?: { lastRefreshedAt?: number } };
    expect(typeof cfg.reviews?.lastRefreshedAt).toBe('number');
  });
});

describe('Reviews ingestion — public feed (5★, latest first)', () => {
  it('returns only 5★ reviews, newest first', async () => {
    const { token, consumerToken } = await makeOrg();
    await importReviews(token, sample);

    const res = await request(app)
      .get('/api/v1/public/reviews')
      .set('Authorization', `Bearer ${consumerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.map((r: { name: string }) => r.name)).toEqual(['Bob', 'Alice']); // 4★ Carol excluded, newest first
    expect(res.body.every((r: { rating: number }) => r.rating === 5)).toBe(true);
    // Public feed emits unix SECONDS (the Astro Reviews component does `time * 1000`),
    // even though Bob was imported from a date string (stored as milliseconds).
    expect(res.body[0].time).toBe(Math.floor(Date.parse('2026-06-12') / 1000));
  });

  it('honors ?limit override', async () => {
    const { token, consumerToken } = await makeOrg();
    await importReviews(token, sample);

    const res = await request(app)
      .get('/api/v1/public/reviews?limit=1')
      .set('Authorization', `Bearer ${consumerToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Bob');
  });
});
