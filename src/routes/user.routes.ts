import { Router } from 'express';
import { authJwt } from '../middleware/auth';
import { tenantScope } from '../middleware/tenant';
import { requirePermission } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { CreateUserSchema, UpdateUserSchema } from '../schemas/user';
import * as userController from '../controllers/user.controller';

// Super admin manages all users; org admin manages only own-org users (scoped in the service).
export const userRoutes = Router();

userRoutes.use(authJwt, tenantScope);

userRoutes.get('/', requirePermission('users:read:own_org'), userController.list);
userRoutes.post('/', requirePermission('users:write:own_org'), validate(CreateUserSchema, 'body'), userController.create);
userRoutes.get('/:id', requirePermission('users:read:own_org'), userController.get);
userRoutes.patch('/:id', requirePermission('users:write:own_org'), validate(UpdateUserSchema, 'body'), userController.update);
userRoutes.delete('/:id', requirePermission('users:write:own_org'), userController.remove);
