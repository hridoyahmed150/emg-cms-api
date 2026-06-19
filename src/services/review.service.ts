import crypto from 'node:crypto';
import type { Review } from '@prisma/client';
import { Prisma, prisma } from '../lib/prisma';
import { NotFoundError } from '../errors/AppError';
import { validateResourceMeta } from './meta.helper';
import { enqueueDelivery } from './delivery.service';
import { createReviewSource, type ReviewsConfig } from './reviewSource';
import type {
  CreateReviewInput,
  UpdateReviewInput,
  ListReviewsQuery,
  ImportReviewItem,
} from '../schemas/review';

/** Serialize a Review for JSON (BigInt `time` -> number; safe for unix-ms range). */
function toJson(r: Review) {
  return { ...r, time: Number(r.time) };
}

export async function listReviews(query: ListReviewsQuery) {
  const where: Prisma.ReviewWhereInput = {};
  if (query.featured !== undefined) where.featured = query.featured;
  if (query.minRating) where.rating = { gte: query.minRating };
  if (query.q) where.text = { contains: query.q, mode: 'insensitive' };

  const [items, total] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy: { time: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.review.count({ where }),
  ]);
  return { items: items.map(toJson), total, page: query.page, limit: query.limit };
}

export async function getReview(id: number) {
  const review = await prisma.review.findFirst({ where: { id } });
  if (!review) throw new NotFoundError('Review not found');
  return toJson(review);
}

export async function createReview(orgId: number, input: CreateReviewInput) {
  const meta = await validateResourceMeta(orgId, 'reviews', input.meta);
  const review = await prisma.review.create({
    data: {
      organizationId: orgId, // also enforced by the tenant extension
      name: input.name,
      avatar: input.avatar ?? null,
      rating: input.rating,
      text: input.text,
      time: BigInt(input.time ?? Date.now()),
      featured: input.featured,
      verified: input.verified,
      reviewUrl: input.reviewUrl ?? null,
      meta,
    },
  });
  await enqueueDelivery(orgId, 'reviews');
  return toJson(review);
}

export async function updateReview(orgId: number, id: number, input: UpdateReviewInput) {
  const data: Prisma.ReviewUpdateManyMutationInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.avatar !== undefined) data.avatar = input.avatar;
  if (input.rating !== undefined) data.rating = input.rating;
  if (input.text !== undefined) data.text = input.text;
  if (input.time !== undefined) data.time = BigInt(input.time);
  if (input.featured !== undefined) data.featured = input.featured;
  if (input.verified !== undefined) data.verified = input.verified;
  if (input.reviewUrl !== undefined) data.reviewUrl = input.reviewUrl;
  if (input.meta !== undefined) data.meta = await validateResourceMeta(orgId, 'reviews', input.meta);

  const res = await prisma.review.updateMany({ where: { id }, data });
  if (res.count === 0) throw new NotFoundError('Review not found');
  await enqueueDelivery(orgId, 'reviews');
  return getReview(id);
}

export async function deleteReview(orgId: number, id: number) {
  const res = await prisma.review.deleteMany({ where: { id } });
  if (res.count === 0) throw new NotFoundError('Review not found');
  await enqueueDelivery(orgId, 'reviews');
}

// ─────────────────────────────────────────────────────────────────────────────
// Ingestion: manual import (seed / fallback) + provider refresh (Places / GBP).
// Dedupe is by (organizationId, externalId) via createMany({ skipDuplicates: true });
// the CMS accumulates so a few-per-call API still keeps it current over cycles.
// ─────────────────────────────────────────────────────────────────────────────

interface IngestRow {
  organizationId: number;
  name: string;
  avatar: string | null;
  rating: number;
  text: string;
  time: bigint;
  reviewUrl: string | null;
  source: string;
  externalId: string;
}

async function insertDeduped(orgId: number, rows: IngestRow[]) {
  const result = rows.length
    ? await prisma.review.createMany({ data: rows, skipDuplicates: true })
    : { count: 0 };
  if (result.count > 0) await enqueueDelivery(orgId, 'reviews');
  await touchLastRefreshed(orgId);
  return { received: rows.length, inserted: result.count, skipped: rows.length - result.count };
}

/** Manual bulk import (paste JSON / bookmarklet output). Append-only + deduped. */
export async function importReviews(orgId: number, items: ImportReviewItem[]) {
  const rows: IngestRow[] = items.map((it) => {
    const time = normalizeTime(it.time);
    return {
      organizationId: orgId,
      name: it.name,
      avatar: it.avatar ?? null,
      rating: it.rating,
      text: it.text,
      time: BigInt(time),
      reviewUrl: it.reviewUrl ?? null,
      source: 'manual',
      externalId: it.externalId ?? contentHash(it.name, time, it.text),
    };
  });
  return insertDeduped(orgId, rows);
}

/** Pull the latest reviews from the org's configured provider and dedupe-insert. */
export async function refreshReviews(orgId: number) {
  const cfg = await getReviewsConfig(orgId);
  const fetched = await createReviewSource(cfg).fetch();
  const rows: IngestRow[] = fetched
    .filter((r) => r.rating >= 1 && r.externalId)
    .map((r) => ({
      organizationId: orgId,
      name: r.name,
      avatar: r.avatar ?? null,
      rating: r.rating,
      text: r.text,
      time: BigInt(r.time),
      reviewUrl: r.reviewUrl ?? null,
      source: cfg.source ?? 'manual',
      externalId: r.externalId,
    }));
  return insertDeduped(orgId, rows);
}

function normalizeTime(t?: string | number): number {
  if (t === undefined || t === null || t === '') return Date.now();
  if (typeof t === 'number') return t;
  const ms = Date.parse(t);
  if (Number.isFinite(ms)) return ms;
  const n = Number(t);
  return Number.isFinite(n) ? n : Date.now();
}

function contentHash(name: string, time: number, text: string): string {
  return 'h:' + crypto.createHash('sha256').update(`${name}|${time}|${text}`).digest('hex').slice(0, 32);
}

/** Read `Organization.config.reviews` (Organization is NOT tenant-scoped). */
async function getReviewsConfig(orgId: number): Promise<ReviewsConfig> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { config: true } });
  const config = org?.config;
  const reviews = config && typeof config === 'object' ? (config as Record<string, unknown>).reviews : undefined;
  return reviews && typeof reviews === 'object' ? (reviews as ReviewsConfig) : {};
}

/** Stamp `config.reviews.lastRefreshedAt = now` (drives the 15-day reminder). */
async function touchLastRefreshed(orgId: number) {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { config: true } });
  const config: Record<string, unknown> =
    org?.config && typeof org.config === 'object' ? { ...(org.config as Record<string, unknown>) } : {};
  const reviews: Record<string, unknown> =
    config.reviews && typeof config.reviews === 'object' ? { ...(config.reviews as Record<string, unknown>) } : {};
  reviews.lastRefreshedAt = Date.now();
  config.reviews = reviews;
  await prisma.organization.update({ where: { id: orgId }, data: { config: config as Prisma.InputJsonValue } });
}
