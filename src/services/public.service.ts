import { prisma } from '../lib/prisma';
import { serializeJob, serializeReview } from '../delivery/serializers';

/** Active jobs in the current tenant, in the public export shape. */
export async function publicJobs() {
  const jobs = await prisma.job.findMany({
    where: { status: 'active' },
    orderBy: { posted: 'desc' },
  });
  return jobs.map(serializeJob);
}

/** All reviews in the current tenant, newest first, in the public export shape. */
export async function publicReviews() {
  const reviews = await prisma.review.findMany({ orderBy: { time: 'desc' } });
  return reviews.map(serializeReview);
}
