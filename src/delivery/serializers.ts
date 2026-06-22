import type { Job, Review } from '@prisma/client';

function metaObject(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === 'object' && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : {};
}

/**
 * Public/export shape for a job: hybrid `meta` flattened to the top level, with
 * core columns taking precedence on key collisions. This is the SoT shape the
 * Astro/WP consumers receive (matches the hand-edited jobs.json shape).
 */
export function serializeJob(job: Job) {
  return {
    ...metaObject(job.meta),
    slug: job.slug,
    title: job.title,
    type: job.type,
    location: job.location,
    posted: job.posted.toISOString(),
    status: job.status,
  };
}

/**
 * The `Review.time` column holds mixed units: numeric-seconds imports (e.g. a
 * hand-edited reviews.json) are stored as-is, while date-string imports, Google
 * refreshes, and `Date.now()` defaults are milliseconds. The public feed contract
 * is unix SECONDS (matches the hand-edited reviews.json and the Astro Reviews
 * component, which does `time * 1000`), so normalize: anything past ~1e11 is
 * milliseconds and gets divided down to seconds.
 */
function toUnixSeconds(time: bigint): number {
  const n = Number(time);
  return n > 1e11 ? Math.floor(n / 1000) : n;
}

export function serializeReview(review: Review) {
  return {
    ...metaObject(review.meta),
    name: review.name,
    avatar: review.avatar ?? undefined, // omit (not null) → matches reviews.json + Astro's string|undefined
    rating: review.rating,
    text: review.text,
    time: toUnixSeconds(review.time),
    featured: review.featured,
    verified: review.verified,
    reviewUrl: review.reviewUrl ?? undefined,
  };
}
