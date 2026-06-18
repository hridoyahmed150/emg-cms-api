import { Router } from 'express';
import multer from 'multer';
import { authJwt } from '../middleware/auth';
import { tenantScope } from '../middleware/tenant';
import { requirePermission } from '../middleware/permission';
import * as uploadController from '../controllers/upload.controller';

const multipart = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

export const uploadRoutes = Router();

uploadRoutes.use(authJwt, tenantScope);

uploadRoutes.post('/', requirePermission('uploads:write'), multipart.single('file'), uploadController.upload);
uploadRoutes.delete('/:id', requirePermission('uploads:delete'), uploadController.remove);
