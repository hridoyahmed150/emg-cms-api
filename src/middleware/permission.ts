import type { Request, Response, NextFunction } from 'express';
import { UnauthorizedError, ForbiddenError } from '../errors/AppError';
import { principalHasPermission } from '../auth/permissions';

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
