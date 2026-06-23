import { Router } from 'express';
import { validate } from '../middleware/validate';
import { authJwt } from '../middleware/auth';
import { loginRateLimiter } from '../middleware/rateLimit';
import { LoginSchema, ChangePasswordSchema } from '../schemas/auth';
import * as authController from '../controllers/auth.controller';

export const authRoutes = Router();

authRoutes.post('/login', loginRateLimiter, validate(LoginSchema, 'body'), authController.login);
authRoutes.post('/refresh', authController.refresh);
authRoutes.post('/logout', authController.logout);
authRoutes.post('/logout-all', authJwt, authController.logoutAll);
authRoutes.post('/change-password', authJwt, validate(ChangePasswordSchema, 'body'), authController.changePassword);
authRoutes.get('/me', authJwt, authController.me);
