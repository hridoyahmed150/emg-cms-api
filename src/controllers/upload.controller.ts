import type { Request, Response } from 'express';
import { parseId, requireTenant } from '../lib/http';
import { withTenant } from '../lib/prisma';
import * as uploadService from '../services/upload.service';

// multer parses multipart via busboy stream events, which run outside the
// AsyncLocalStorage tenant context set by tenantScope. Re-establish it here with
// withTenant so the tenant-scoped Upload queries don't lose their context.

export async function upload(req: Request, res: Response): Promise<void> {
  const orgId = requireTenant(req);
  const result = await withTenant({ tenantId: orgId, isSuper: req.isSuper ?? false }, () =>
    uploadService.uploadFile(orgId, req.file, req.auth?.userId ?? null),
  );
  res.status(201).json(result);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const orgId = requireTenant(req);
  await withTenant({ tenantId: orgId, isSuper: req.isSuper ?? false }, () =>
    uploadService.deleteUpload(parseId(req)),
  );
  res.status(204).send();
}
