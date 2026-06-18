import type { Request, Response } from 'express';
import { parseId, requireTenant } from '../lib/http';
import * as uploadService from '../services/upload.service';

export async function upload(req: Request, res: Response): Promise<void> {
  const orgId = requireTenant(req);
  res.status(201).json(await uploadService.uploadFile(orgId, req.file, req.auth?.userId ?? null));
}

export async function remove(req: Request, res: Response): Promise<void> {
  requireTenant(req); // ensure a tenant context for the scoped delete
  await uploadService.deleteUpload(parseId(req));
  res.status(204).send();
}
