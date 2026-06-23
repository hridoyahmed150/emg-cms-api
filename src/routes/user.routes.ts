import { Router } from 'express';
import { authJwt } from '../middleware/auth';
import { tenantScope } from '../middleware/tenant';
import { requirePermission, requireSuperAdmin } from '../middleware/permission';
import { validate } from '../middleware/validate';
import { CreateUserSchema, UpdateUserSchema, ResetPasswordSchema } from '../schemas/user';
import * as userController from '../controllers/user.controller';

// User management is SUPER_ADMIN-only: requireSuperAdmin is the hard gate, and the
// users:* permissions (held only via SUPER_ADMIN's '*') document intent + future-proof.
export const userRoutes = Router();

userRoutes.use(authJwt, tenantScope, requireSuperAdmin);

userRoutes.get('/', requirePermission('users:read'), userController.list);
userRoutes.post('/', requirePermission('users:write'), validate(CreateUserSchema, 'body'), userController.create);
userRoutes.get('/:id', requirePermission('users:read'), userController.get);
userRoutes.patch('/:id', requirePermission('users:write'), validate(UpdateUserSchema, 'body'), userController.update);
// Dedicated reset action: generates a temp password (returned once) or sets a specific one,
// forces a change on next login, and invalidates the target's sessions. Sub-path of /:id → no
// conflict with the PATCH/GET/DELETE /:id routes above.
userRoutes.post('/:id/reset-password', requirePermission('users:write'), validate(ResetPasswordSchema, 'body'), userController.resetPassword);
userRoutes.delete('/:id', requirePermission('users:delete'), userController.remove);
