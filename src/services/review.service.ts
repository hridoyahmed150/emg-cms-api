import crypto from 'node:crypto';
import type { Review } from '@prisma/client';
import { Prisma, prisma } from '../lib/prisma';
import { NotFoundError, BadRequestError } from '../errors/AppError';
import { validateResourceMeta } from './meta.helper';
import { markContentChanged } from './delivery.service';
import { readFile } from '../delivery/bitbucket.client';
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
  await markContentChanged(orgId);
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
  await markContentChanged(orgId);
  return getReview(id);
}

export async function deleteReview(orgId: number, id: number) {
  const res = await prisma.review.deleteMany({ where: { id } });
  if (res.count === 0) throw new NotFoundError('Review not found');
  await markContentChanged(orgId);
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
  if (result.count > 0) await markContentChanged(orgId);
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

/** Hard cap on a single reverse-import. The HTTP /import route caps at 200 via its Zod
 * schema; this path bypasses that schema, so guard against a huge/accidental repo file. */
const MAX_REPO_IMPORT = 500;

/** Mixed-unit (seconds or ms) → unix seconds, matching serializeReview's toUnixSeconds. */
const toSeconds = (n: number): number => (n > 1e11 ? Math.floor(n / 1000) : n);

/**
 * Reverse-import: pull the org's EXISTING reviews.json from its Bitbucket repo INTO the
 * CMS (deduped). Run during onboarding, BEFORE the first Publish — the CMS overwrites
 * reviews.json on Publish, so pre-existing repo reviews not yet in the CMS would be
 * clobbered. Idempotent AND cross-source safe: an incoming item is dropped if an
 * equivalent review (same name+text+second-precision time) already exists in the CMS,
 * regardless of how that row was keyed. So importing a repo whose reviews already came
 * from Google won't double the corpus (which would inflate the JSON-LD aggregateRating),
 * and re-running with a different time format (seconds↔ms↔date-string) is still a no-op.
 * Returns the insert summary, or a `note` when there's no file / nothing new.
 */
export async function importReviewsFromRepo(
  orgId: number,
): Promise<{ received: number; inserted: number; skipped: number; note?: string }> {
  const git = await getGitConfig(orgId);
  if (!git?.repo || !git?.path) {
    throw new BadRequestError(
      'No Astro repo configured. Set the Bitbucket repo (config.git.repo/path) in org settings first.',
    );
  }
  // Defense-in-depth: config.git.path is super-admin-set, but never let it traverse the repo.
  if (git.path.includes('..') || git.path.startsWith('/')) {
    throw new BadRequestError('Invalid git path (must be a repo-relative path without "..").');
  }

  const raw = await readFile({ repo: git.repo, branch: git.branch || 'main', path: git.path });
  if (raw == null) {
    await touchLastRefreshed(orgId);
    return { received: 0, inserted: 0, skipped: 0, note: `No ${git.path} in ${git.repo} — nothing to import.` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestError(`${git.path} in the repo is not valid JSON.`);
  }
  const items = parseReviewsFile(parsed);
  if (items.length === 0) {
    await touchLastRefreshed(orgId);
    return { received: 0, inserted: 0, skipped: 0, note: `No reviews found in ${git.path}.` };
  }
  if (items.length > MAX_REPO_IMPORT) {
    throw new BadRequestError(
      `${git.path} has ${items.length} reviews (max ${MAX_REPO_IMPORT} per import). Trim the file or import in batches.`,
    );
  }

  // Cross-source + idempotency dedupe: skip items whose content already exists in the CMS
  // (by name+text+second-precision time), independent of how the existing row was keyed.
  // findMany is tenant-scoped to this org by the Prisma extension.
  const existing = await prisma.review.findMany({ select: { name: true, text: true, time: true } });
  const present = new Set(existing.map((r) => contentHash(r.name, toSeconds(Number(r.time)), r.text)));
  const fresh = items.filter((it) => !present.has(contentHash(it.name, toSeconds(normalizeTime(it.time)), it.text)));

  if (fresh.length === 0) {
    await touchLastRefreshed(orgId);
    return { received: items.length, inserted: 0, skipped: items.length, note: 'All reviews already in the CMS.' };
  }
  const res = await importReviews(orgId, fresh);
  // Report against the whole file (importReviews only saw the fresh subset).
  return { received: items.length, inserted: res.inserted, skipped: items.length - res.inserted };
}

const asString = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Defensive parser for a repo's reviews.json → import items. Accepts either a bare array
 * or a `{ reviews: [...] }` wrapper (the ReviewsData shape the CMS commits), and tolerates
 * alternate field names from hand-edited files (author/comment/date/url, etc.). Entries
 * missing name/text or a valid 1–5 rating are dropped. `time` passes through unchanged
 * (number or string) — importReviews + serializeReview normalize the units on round-trip.
 * Exported for unit testing.
 */
export function parseReviewsFile(parsed: unknown): ImportReviewItem[] {
  const arr: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).reviews)
      ? ((parsed as Record<string, unknown>).reviews as unknown[])
      : [];

  const items: ImportReviewItem[] = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    const name = asString(r.name ?? r.author ?? r.authorName ?? r.reviewer);
    const text = asString(r.text ?? r.comment ?? r.content ?? r.review ?? r.body);
    const rating = Math.trunc(Number(r.rating ?? r.stars ?? r.score));
    if (!name || !text || !Number.isFinite(rating) || rating < 1 || rating > 5) continue;

    const item: ImportReviewItem = { name, text, rating };
    const time = r.time ?? r.date ?? r.createdAt ?? r.datePublished;
    if (typeof time === 'number' || typeof time === 'string') item.time = time;
    const avatar = asString(r.avatar ?? r.profilePhoto ?? r.avatarUrl ?? r.photo);
    if (avatar) item.avatar = avatar;
    const reviewUrl = asString(r.reviewUrl ?? r.url ?? r.link);
    if (reviewUrl) item.reviewUrl = reviewUrl;
    const externalId = asString(r.externalId); // only an explicit, stable id — never a local index
    if (externalId) item.externalId = externalId;
    items.push(item);
  }
  return items;
}

/** Read `Organization.config.git` (Organization is NOT tenant-scoped). */
async function getGitConfig(orgId: number): Promise<{ repo?: string; branch?: string; path?: string } | null> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { config: true } });
  const git = org?.config && typeof org.config === 'object' ? (org.config as Record<string, unknown>).git : undefined;
  return git && typeof git === 'object' ? (git as { repo?: string; branch?: string; path?: string }) : null;
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
