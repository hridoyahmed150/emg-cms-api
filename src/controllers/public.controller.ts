import type { Request, Response } from 'express';
import * as publicService from '../services/public.service';

export async function jobs(_req: Request, res: Response): Promise<void> {
  res.json(await publicService.publicJobs());
}

function numParam(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

export async function reviews(req: Request, res: Response): Promise<void> {
  const overrides = { minRating: numParam(req.query.minRating), limit: numParam(req.query.limit) };
  res.json(await publicService.publicReviews(req.tenantId ?? null, overrides));
}
