import { Router } from 'express';
import { authJwt } from '../middleware/auth';
import { tenantScope } from '../middleware/tenant';
import { requirePermission, requireSuperAdmin } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { CreateTokenSchema } from '../schemas/token';
import * as tokenController from '../controllers/token.controller';

// Consumer (read-only) API tokens are SUPER_ADMIN-only: requireSuperAdmin is the hard gate,
// and the tokens:* permissions (held only via SUPER_ADMIN's '*') document intent. Astro/CloudCannon
// clients (commit-on-publish) need no token at all; WordPress/external consumers get one issued by EMG.
export const tokenRoutes = Router();

tokenRoutes.use(authJwt, tenantScope, requireSuperAdmin);

tokenRoutes.get('/', requirePermission('tokens:read'), tokenController.list);
tokenRoutes.post('/', requirePermission('tokens:write'), validate(CreateTokenSchema, 'body'), tokenController.create);
tokenRoutes.delete('/:id', requirePermission('tokens:write'), tokenController.revoke);
