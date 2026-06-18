import type { Review } from '@prisma/client';
import { Prisma, prisma } from '../lib/prisma';
import { NotFoundError } from '../errors/AppError';
import { validateResourceMeta } from './meta.helper';
import { enqueueDelivery } from './delivery.service';
import type { CreateReviewInput, UpdateReviewInput, ListReviewsQuery } from '../schemas/review';

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
