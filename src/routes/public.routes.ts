import { Router } from 'express';
import { authConsumerToken } from '../middleware/consumerAuth';
import { tenantScope } from '../middleware/tenant';
import { requirePermission } from '../middleware/permission';
import { consumerApiRateLimiter } from '../middleware/rateLimit';
import * as publicController from '../controllers/public.controller';

/** Read-only pull API for consumers (Astro build, WP plugin). Auth = consumer token. */
export const publicRoutes = Router();

publicRoutes.use(consumerApiRateLimiter, authConsumerToken, tenantScope);

publicRoutes.get('/jobs', requirePermission('jobs:read'), publicController.jobs);
publicRoutes.get('/reviews', requirePermission('reviews:read'), publicController.reviews);
