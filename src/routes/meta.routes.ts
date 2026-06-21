import { Router } from 'express';
import { authJwt } from '../middleware/auth';
import * as metaController from '../controllers/meta.controller';

// Non-sensitive metadata for any authenticated dashboard user.
export const metaRoutes = Router();

metaRoutes.use(authJwt);
metaRoutes.get('/permissions', metaController.permissions);
