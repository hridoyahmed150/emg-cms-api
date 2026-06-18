import type { Request, Response } from 'express';
import * as publicService from '../services/public.service';

export async function jobs(_req: Request, res: Response): Promise<void> {
  res.json(await publicService.publicJobs());
}

export async function reviews(_req: Request, res: Response): Promise<void> {
  res.json(await publicService.publicReviews());
}
