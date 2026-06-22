import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { Role } from '@prisma/client';

// Mock the Bitbucket client so reverse-import never hits the network (hoisted above all imports).
vi.mock('../src/delivery/bitbucket.client', () => ({
  readFile: vi.fn(),
  commitFile: vi.fn(),
}));

import { createApp } from '../src/server';
import { prisma, withTenant } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/password';
import { signAccessToken } from '../src/lib/jwt';
import { generateConsumerToken } from '../src/lib/apiToken';
import { buildReviewsData } from '../src/services/public.service';
import { importReviewsFromRepo, parseReviewsFile } from '../src/services/review.service';
import { readFile } from '../src/delivery/bitbucket.client';

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

describe('Reviews ingestion — committed payload (buildReviewsData)', () => {
  it('aggregateRating reflects the FULL corpus, not the 5★ display subset', async () => {
    const { org, token } = await makeOrg();
    await importReviews(token, sample); // 2×5★ + 1×4★

    const data = await withTenant({ tenantId: org.id, isSuper: false }, () => buildReviewsData(org.id));

    expect(data.reviews).toHaveLength(2); // display = 5★ only (Bob, Alice)
    expect(data.totalReviewCount).toBe(3); // aggregate counts all 3
    expect(data.averageRating).toBe(4.7); // (5+5+4)/3 = 4.666… → 4.7, NOT a forced 5.0
  });
});

describe('Reviews reverse-import — parseReviewsFile (defensive parser)', () => {
  it('parses the CMS ReviewsData wrapper shape', () => {
    const items = parseReviewsFile({
      source: 'Google',
      averageRating: 5,
      totalReviewCount: 2,
      reviews: [
        { name: 'Alice', rating: 5, text: 'Great', time: 1780272000 },
        { name: 'Bob', rating: 4, text: 'Good', time: 1780358400 },
      ],
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ name: 'Alice', rating: 5, text: 'Great', time: 1780272000 });
  });

  it('parses a bare array and tolerates alternate field names', () => {
    const items = parseReviewsFile([
      {
        author: 'Carol',
        stars: 5,
        comment: 'Loved it',
        date: '2026-06-10',
        profilePhoto: 'http://x/p.jpg',
        url: 'http://x/r',
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: 'Carol',
      rating: 5,
      text: 'Loved it',
      time: '2026-06-10',
      avatar: 'http://x/p.jpg',
      reviewUrl: 'http://x/r',
    });
  });

  it('drops entries missing name/text or with an out-of-range rating', () => {
    const items = parseReviewsFile([
      { name: '', text: 'x', rating: 5 }, // no name
      { name: 'A', text: '', rating: 5 }, // no text
      { name: 'B', text: 'y', rating: 9 }, // rating > 5
      { name: 'C', text: 'z', rating: 5 }, // valid
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.name).toBe('C');
  });

  it('returns [] for non-review JSON', () => {
    expect(parseReviewsFile({ foo: 'bar' })).toEqual([]);
    expect(parseReviewsFile(null)).toEqual([]);
    expect(parseReviewsFile('nope')).toEqual([]);
  });
});

describe('Reviews reverse-import — importReviewsFromRepo (repo → CMS)', () => {
  async function setGitConfig(orgId: number) {
    await prisma.organization.update({
      where: { id: orgId },
      data: { config: { git: { repo: 'housefx', branch: 'main', path: 'src/data/reviews.json' } } },
    });
  }

  it('reads the repo file, imports deduped, and is idempotent', async () => {
    const { org } = await makeOrg();
    await setGitConfig(org.id);
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        reviews: [
          { name: 'Alice', rating: 5, text: 'Great service', time: 1780272000 },
          { name: 'Bob', rating: 5, text: 'Awesome team', time: 1780358400 },
        ],
      }),
    );

    const first = await withTenant({ tenantId: org.id, isSuper: false }, () => importReviewsFromRepo(org.id));
    expect(first).toMatchObject({ received: 2, inserted: 2, skipped: 0 });

    const second = await withTenant({ tenantId: org.id, isSuper: false }, () => importReviewsFromRepo(org.id));
    expect(second).toMatchObject({ received: 2, inserted: 0, skipped: 2 }); // content-hash dedupe
  });

  it('returns a note (no throw) when the repo has no reviews.json', async () => {
    const { org } = await makeOrg();
    await setGitConfig(org.id);
    vi.mocked(readFile).mockResolvedValue(null);

    const res = await withTenant({ tenantId: org.id, isSuper: false }, () => importReviewsFromRepo(org.id));
    expect(res.inserted).toBe(0);
    expect(res.note).toContain('nothing to import');
  });

  it('throws when no git repo is configured', async () => {
    const { org } = await makeOrg();
    await expect(
      withTenant({ tenantId: org.id, isSuper: false }, () => importReviewsFromRepo(org.id)),
    ).rejects.toThrow(/repo/i);
  });

  it('does not double a cross-source review (Google externalId + ms vs repo content-hash + seconds)', async () => {
    const { org, token } = await makeOrg();
    await setGitConfig(org.id);
    // Seed as if from Google: explicit externalId, time in MILLISECONDS.
    await importReviews(token, [
      { name: 'Alice', rating: 5, text: 'Great service', time: 1780272000000, externalId: 'g1' },
    ]);
    // Repo file holds the SAME review, NO externalId, time in SECONDS.
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ reviews: [{ name: 'Alice', rating: 5, text: 'Great service', time: 1780272000 }] }),
    );

    const res = await withTenant({ tenantId: org.id, isSuper: false }, () => importReviewsFromRepo(org.id));
    expect(res.inserted).toBe(0); // recognized as already present despite ms↔seconds + different key
    const count = await withTenant({ tenantId: org.id, isSuper: false }, () => prisma.review.count());
    expect(count).toBe(1); // not doubled
  });

  it('rejects an oversized repo file (row cap)', async () => {
    const { org } = await makeOrg();
    await setGitConfig(org.id);
    const many = Array.from({ length: 501 }, (_, i) => ({
      name: `R${i}`,
      rating: 5,
      text: `t${i}`,
      time: 1780272000 + i,
    }));
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ reviews: many }));

    await expect(
      withTenant({ tenantId: org.id, isSuper: false }, () => importReviewsFromRepo(org.id)),
    ).rejects.toThrow(/max/i);
  });
});
