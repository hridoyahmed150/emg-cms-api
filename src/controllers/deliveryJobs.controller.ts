import type { Request, Response } from 'express';
import { parseId } from '../lib/http';
import * as deliveryService from '../services/deliveryJobs.service';

export async function list(_req: Request, res: Response): Promise<void> {
  res.json(await deliveryService.listDeliveryJobs());
}

export async function retry(req: Request, res: Response): Promise<void> {
  await deliveryService.retryDeliveryJob(parseId(req));
  res.json({ ok: true });
}
