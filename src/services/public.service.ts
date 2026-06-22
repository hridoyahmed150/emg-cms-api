import { prisma } from '../lib/prisma';
import { serializeJob, serializeReview } from '../delivery/serializers';
import { REVIEWS_DEFAULTS, type ReviewsConfig } from './reviewSource';

/** Active jobs in the current tenant, in the public export shape. */
export async function publicJobs() {
  const jobs = await prisma.job.findMany({
    where: { status: 'active' },
    orderBy: { posted: 'desc' },
  });
  return jobs.map(serializeJob);
}

/**
 * The full jobs.json payload committed to an org's Astro repo on Publish — a BARE ARRAY
 * (matches the hand-edited jobs.json shape; unlike reviews this has no wrapper object).
 * Includes active AND expired jobs (the listing page badges expired ones); only `draft`
 * is withheld. MUST run in the org's tenant context (the delivery worker runs as SUPER);
 * findMany is tenant-scoped by the Prisma extension. `_orgId` is accepted for symmetry
 * with buildReviewsData — the tenant scope, not the arg, filters the rows.
 */
export async function buildJobsData(_orgId: number | null) {
  const jobs = await prisma.job.findMany({
    where: { status: { not: 'draft' } },
    orderBy: { posted: 'desc' },
  });
  return jobs.map(serializeJob);
}

/** Read `Organization.config.reviews` (Organization is NOT tenant-scoped). */
async function reviewsConfig(orgId: number | null): Promise<ReviewsConfig> {
  if (orgId == null) return {};
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { config: true } });
  const reviews =
    org?.config && typeof org.config === 'object' ? (org.config as Record<string, unknown>).reviews : undefined;
  return reviews && typeof reviews === 'object' ? (reviews as ReviewsConfig) : {};
}

const clampRating = (n: number) => Math.min(5, Math.max(1, Math.trunc(n)));
const clampLimit = (n: number) => Math.min(100, Math.max(1, Math.trunc(n)));

/**
 * Reviews for the current tenant in the public export shape, newest first,
 * filtered to `minRating`+ and capped at `limit` (defaults: 5★, latest 20, from
 * the org's config). The tenant extension still scopes the query to this org —
 * `orgId` is only used to read display config. Query overrides are optional.
 */
export async function publicReviews(
  orgId: number | null,
  overrides?: { minRating?: number; limit?: number },
) {
  const cfg = await reviewsConfig(orgId);
  const minRating = clampRating(overrides?.minRating ?? cfg.minRating ?? REVIEWS_DEFAULTS.minRating);
  const limit = clampLimit(overrides?.limit ?? cfg.limit ?? REVIEWS_DEFAULTS.limit);

  const reviews = await prisma.review.findMany({
    where: { rating: { gte: minRating } },
    orderBy: { time: 'desc' },
    take: limit,
  });
  return reviews.map(serializeReview);
}

/**
 * The full reviews.json payload (ReviewsData shape) that gets committed to an org's
 * Astro repo on Publish. MUST run in the org's tenant context (the delivery worker
 * runs as SUPER, which would otherwise pull every org's reviews). `time` is unix
 * seconds (serializeReview), matching the committed reviews.json and Astro component.
 */
export async function buildReviewsData(orgId: number | null) {
  const reviews = await publicReviews(orgId); // filtered + capped DISPLAY set (e.g. 5★, latest 20)

  // aggregateRating must reflect the FULL corpus, not the display subset — otherwise the 5★
  // display filter forces averageRating to 5.0 and caps reviewCount at the display limit, which
  // ships misleading JSON-LD. Compute over every review the CMS holds for this org (findMany is
  // tenant-scoped). For a true Google total beyond what the CMS holds, import the full set.
  const all = await prisma.review.findMany({ select: { rating: true } });
  const totalReviewCount = all.length;
  const averageRating = all.length
    ? Math.round((all.reduce((sum, r) => sum + r.rating, 0) / all.length) * 10) / 10
    : 0;

  const cfg = (await reviewsConfig(orgId)) as Record<string, unknown>;
  const businessReviewUrl = typeof cfg.googleMapsUrl === 'string' ? cfg.googleMapsUrl : undefined;
  return {
    source: 'Google',
    ...(businessReviewUrl ? { businessReviewUrl } : {}),
    averageRating,
    totalReviewCount,
    reviews,
  };
}
