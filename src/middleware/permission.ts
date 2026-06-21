import type { Request, Response, NextFunction } from 'express';
import { UnauthorizedError, ForbiddenError } from '../errors/AppError';
import { principalHasPermission } from '../auth/permissions';
import { prisma } from '../lib/prisma';

/** Guard a route with a required permission (e.g. 'jobs:write'). */
export function requirePermission(permission: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = req.auth;
    if (!auth) {
      next(new UnauthorizedError());
      return;
    }
    if (!principalHasPermission(auth, permission)) {
      next(new ForbiddenError(`Missing permission: ${permission}`));
      return;
    }
    next();
  };
}

/**
 * Hard guard for SUPER_ADMIN-only routes (user management). Defense-in-depth on top of
 * the permission check — even if ROLE_PERMISSIONS is later misconfigured to grant a
 * non-super role a `users:*` permission, this still blocks anyone who isn't SUPER_ADMIN.
 */
export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction): void {
  const auth = req.auth;
  if (!auth) {
    next(new UnauthorizedError());
    return;
  }
  if (auth.role !== 'SUPER_ADMIN') {
    next(new ForbiddenError('Super admin only'));
    return;
  }
  next();
}

/**
 * Gate a route by an organization feature flag (`Organization.features`). A module is
 * ENABLED unless the org sets it explicitly to `false`, so legacy orgs (features: {})
 * keep working. Super admins running cross-org (no tenant selected) are not gated.
 * Must run after tenantScope (reads req.tenantId).
 */
export function requireFeature(feature: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = req.tenantId ?? null;
      if (orgId == null) {
        next(); // super admin, no specific org → nothing to gate
        return;
      }
      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { features: true },
      });
      const features = (org?.features ?? {}) as Record<string, unknown>;
      if (features[feature] === false) {
        next(new ForbiddenError(`The "${feature}" module is disabled for this organization`));
        return;
      }
      next();
    } catch (e) {
      next(e as Error);
    }
  };
}
