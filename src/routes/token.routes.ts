import { Router } from 'express';
import { authJwt } from '../middleware/auth';
import { tenantScope } from '../middleware/tenant';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { CreateTokenSchema } from '../schemas/token';
import * as tokenController from '../controllers/token.controller';

export const tokenRoutes = Router();

tokenRoutes.use(authJwt, tenantScope);

tokenRoutes.get('/', requirePermission('tokens:read:own'), tokenController.list);
tokenRoutes.post('/', requirePermission('tokens:write:own'), validate(CreateTokenSchema, 'body'), tokenController.create);
tokenRoutes.delete('/:id', requirePermission('tokens:write:own'), tokenController.revoke);
