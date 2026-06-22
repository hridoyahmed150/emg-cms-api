import type { Request, Response } from 'express';
import { validated } from '../middleware/validate';
import * as reviewService from '../services/review.service';
import { BadRequestError } from '../errors/AppError';
import type {
  CreateReviewInput,
  UpdateReviewInput,
  ListReviewsQuery,
  ImportReviewsInput,
} from '../schemas/review';

function requireTenant(req: Request): number {
  if (req.tenantId == null) {
    throw new BadRequestError('Organization context required (super admin: pass ?orgId).');
  }
  return req.tenantId;
}

function parseId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestError('Invalid id');
  return id;
}

export async function list(req: Request, res: Response): Promise<void> {
  const query = validated<ListReviewsQuery>(req, 'query');
  res.json(await reviewService.listReviews(query));
}

export async function get(req: Request, res: Response): Promise<void> {
  res.json(await reviewService.getReview(parseId(req)));
}

export async function create(req: Request, res: Response): Promise<void> {
  const orgId = requireTenant(req);
  const input = validated<CreateReviewInput>(req, 'body');
  res.status(201).json(await reviewService.createReview(orgId, input));
}

export async function update(req: Request, res: Response): Promise<void> {
  const orgId = requireTenant(req);
  const input = validated<UpdateReviewInput>(req, 'body');
  res.json(await reviewService.updateReview(orgId, parseId(req), input));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const orgId = requireTenant(req);
  await reviewService.deleteReview(orgId, parseId(req));
  res.status(204).send();
}

/** Bulk import reviews (manual seed / fallback). Deduped; returns insert summary. */
export async function importBulk(req: Request, res: Response): Promise<void> {
  const orgId = requireTenant(req);
  const input = validated<ImportReviewsInput>(req, 'body');
  res.json(await reviewService.importReviews(orgId, input.reviews));
}

/** Refresh reviews from the org's configured Google source (Places / GBP). */
export async function refresh(req: Request, res: Response): Promise<void> {
  const orgId = requireTenant(req);
  res.json(await reviewService.refreshReviews(orgId));
}

/** Reverse-import the org's existing reviews.json from its Bitbucket repo (onboarding seed). */
export async function importFromRepo(req: Request, res: Response): Promise<void> {
  const orgId = requireTenant(req);
  res.json(await reviewService.importReviewsFromRepo(orgId));
}
