import { Router } from 'express';
import { authJwt } from '../middleware/auth';
import { tenantScope } from '../middleware/tenant';
import { requirePermission } from '../middleware/permission';
import * as deliveryController from '../controllers/deliveryJobs.controller';

export const deliveryJobsRoutes = Router();

deliveryJobsRoutes.use(authJwt, tenantScope);

deliveryJobsRoutes.get('/', requirePermission('delivery:read:own'), deliveryController.list);
deliveryJobsRoutes.post('/publish', requirePermission('delivery:publish:own'), deliveryController.publish);
deliveryJobsRoutes.post('/:id/retry', requirePermission('delivery:retry:own'), deliveryController.retry);
