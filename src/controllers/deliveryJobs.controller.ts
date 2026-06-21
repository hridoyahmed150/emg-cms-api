import type { Request, Response } from 'express';
import { parseId } from '../lib/http';
import { BadRequestError } from '../errors/AppError';
import * as deliveryService from '../services/deliveryJobs.service';
import { publishNow } from '../services/delivery.service';

export async function list(_req: Request, res: Response): Promise<void> {
  res.json(await deliveryService.listDeliveryJobs());
}

export async function retry(req: Request, res: Response): Promise<void> {
  await deliveryService.retryDeliveryJob(parseId(req));
  res.json({ ok: true });
}

/** Manually publish the current org's content to its site (one rebuild / cache-bust). */
export async function publish(req: Request, res: Response): Promise<void> {
  const orgId = req.tenantId ?? null;
  if (orgId == null) throw new BadRequestError('Select an organization to publish');
  const result = await publishNow(orgId);
  res.json({ ok: true, ...result });
}
