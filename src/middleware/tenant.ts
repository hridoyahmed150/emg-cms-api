import type { Request, Response, NextFunction } from 'express';
import { tenantContext } from '../lib/prisma';
import { UnauthorizedError, ForbiddenError } from '../errors/AppError';

/**
 * Resolve the tenant for this request and enter the AsyncLocalStorage tenant
 * context for the remainder of the request, so tenant-scoped Prisma queries are
 * auto-filtered (Layer 2 + the bridge to Layer 3).
 *
 * The tenant is taken ONLY from the authenticated principal (JWT/consumer token),
 * never from request body/query/params. SUPER_ADMIN may optionally target a
 * specific org via `?orgId=`; otherwise it runs unscoped (cross-org).
 */
export function tenantScope(req: Request, _res: Response, next: NextFunction): void {
  const auth = req.auth;
  if (!auth) {
    next(new UnauthorizedError());
    return;
  }

  let ctx: { tenantId: number | null; isSuper: boolean };

  if (auth.role === 'SUPER_ADMIN') {
    const raw = req.query.orgId;
    const parsed = typeof raw === 'string' && raw.length > 0 ? Number(raw) : NaN;
    const tenantId = Number.isInteger(parsed) ? parsed : null;
    req.tenantId = tenantId;
    req.isSuper = true;
    ctx = { tenantId, isSuper: true };
  } else {
    if (auth.organizationId == null) {
      next(new ForbiddenError('No tenant assigned to this principal'));
      return;
    }
    req.tenantId = auth.organizationId; // from token only
    req.isSuper = false;
    ctx = { tenantId: auth.organizationId, isSuper: false };
  }

  // Enter the tenant context for the rest of the request chain.
  tenantContext.run(ctx, () => next());
}
