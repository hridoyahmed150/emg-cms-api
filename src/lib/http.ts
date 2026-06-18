import type { Request } from 'express';
import { BadRequestError } from '../errors/AppError';

/** Parse a positive integer `:id` route param or throw 400. */
export function parseId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestError('Invalid id');
  return id;
}

/** Require a resolved tenant (super admin must pass ?orgId for org-scoped writes). */
export function requireTenant(req: Request): number {
  if (req.tenantId == null) {
    throw new BadRequestError('Organization context required (super admin: pass ?orgId).');
  }
  return req.tenantId;
}
