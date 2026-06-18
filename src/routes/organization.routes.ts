import { Router } from 'express';
import { authJwt } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { CreateOrganizationSchema, UpdateOrganizationSchema } from '../schemas/organization';
import * as orgController from '../controllers/organization.controller';

// Organizations are super-admin-only (ADMIN lacks 'organizations:*' → 403; SUPER_ADMIN has '*').
export const organizationRoutes = Router();

organizationRoutes.use(authJwt);

organizationRoutes.get('/', requirePermission('organizations:read'), orgController.list);
organizationRoutes.post('/', requirePermission('organizations:write'), validate(CreateOrganizationSchema, 'body'), orgController.create);
organizationRoutes.get('/:id', requirePermission('organizations:read'), orgController.get);
organizationRoutes.patch('/:id', requirePermission('organizations:write'), validate(UpdateOrganizationSchema, 'body'), orgController.update);
organizationRoutes.delete('/:id', requirePermission('organizations:write'), orgController.remove);
