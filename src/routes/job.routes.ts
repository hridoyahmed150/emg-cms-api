import { Router } from 'express';
import { authJwt } from '../middleware/auth';
import { tenantScope } from '../middleware/tenant';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { CreateJobSchema, UpdateJobSchema, ListJobsQuerySchema } from '../schemas/job';
import * as jobController from '../controllers/job.controller';

export const jobRoutes = Router();

// All job routes require auth + tenant scope (enters the tenant context).
jobRoutes.use(authJwt, tenantScope);

jobRoutes.get('/', requirePermission('jobs:read'), validate(ListJobsQuerySchema, 'query'), jobController.list);
jobRoutes.post('/', requirePermission('jobs:write'), validate(CreateJobSchema, 'body'), jobController.create);
jobRoutes.get('/:id', requirePermission('jobs:read'), jobController.get);
jobRoutes.patch('/:id', requirePermission('jobs:write'), validate(UpdateJobSchema, 'body'), jobController.update);
jobRoutes.delete('/:id', requirePermission('jobs:delete'), jobController.remove);
