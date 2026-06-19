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
