import type { Request, Response } from 'express';
import { ROLE_PERMISSIONS, PERMISSION_CATALOG } from '../auth/permissions';

/**
 * Read-only metadata for the dashboard: the role→permissions map and a labelled
 * permission catalog. Used by the (super-admin) Users page to display what each
 * user can do. Editing permissions is intentionally not exposed yet.
 */
export function permissions(_req: Request, res: Response): void {
  res.json({ roles: ROLE_PERMISSIONS, catalog: PERMISSION_CATALOG });
}
