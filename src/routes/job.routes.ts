import { Router } from 'express';
import { authJwt } from '../middleware/auth';
import { tenantScope } from '../middleware/tenant';
import { requirePermission, requireFeature } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { CreateJobSchema, UpdateJobSchema, ListJobsQuerySchema } from '../schemas/job';
import * as jobController from '../controllers/job.controller';

export const jobRoutes = Router();

// All job routes require auth + tenant scope (enters the tenant context) + the 'jobs' module on.
jobRoutes.use(authJwt, tenantScope, requireFeature('jobs'));

jobRoutes.get('/', requirePermission('jobs:read'), validate(ListJobsQuerySchema, 'query'), jobController.list);
jobRoutes.post('/', requirePermission('jobs:write'), validate(CreateJobSchema, 'body'), jobController.create);
// Reverse-import from the repo (static path — before '/:id').
jobRoutes.post('/import-from-repo', requirePermission('jobs:write'), jobController.importFromRepo);
jobRoutes.get('/:id', requirePermission('jobs:read'), jobController.get);
jobRoutes.patch('/:id', requirePermission('jobs:write'), validate(UpdateJobSchema, 'body'), jobController.update);
jobRoutes.delete('/:id', requirePermission('jobs:delete'), jobController.remove);
