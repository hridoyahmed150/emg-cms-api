import { Router } from 'express';
import { authJwt } from '../middleware/auth';
import { tenantScope } from '../middleware/tenant';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import {
  CreateReviewSchema,
  UpdateReviewSchema,
  ListReviewsQuerySchema,
  ImportReviewsSchema,
} from '../schemas/review';
import * as reviewController from '../controllers/review.controller';

export const reviewRoutes = Router();

reviewRoutes.use(authJwt, tenantScope);

reviewRoutes.get('/', requirePermission('reviews:read'), validate(ListReviewsQuerySchema, 'query'), reviewController.list);
reviewRoutes.post('/', requirePermission('reviews:write'), validate(CreateReviewSchema, 'body'), reviewController.create);
// Ingestion (static paths — declared before '/:id' params; no POST param route exists anyway).
reviewRoutes.post('/import', requirePermission('reviews:write'), validate(ImportReviewsSchema, 'body'), reviewController.importBulk);
reviewRoutes.post('/refresh', requirePermission('reviews:write'), reviewController.refresh);
reviewRoutes.get('/:id', requirePermission('reviews:read'), reviewController.get);
reviewRoutes.patch('/:id', requirePermission('reviews:write'), validate(UpdateReviewSchema, 'body'), reviewController.update);
reviewRoutes.delete('/:id', requirePermission('reviews:delete'), reviewController.remove);
