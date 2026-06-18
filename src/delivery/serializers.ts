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

export function serializeReview(review: Review) {
  return {
    ...metaObject(review.meta),
    name: review.name,
    avatar: review.avatar,
    rating: review.rating,
    text: review.text,
    time: Number(review.time),
    featured: review.featured,
    verified: review.verified,
    reviewUrl: review.reviewUrl,
  };
}
