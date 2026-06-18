import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/jwt';
import { UnauthorizedError } from '../errors/AppError';

/** Authenticate a request via a Bearer JWT access token and set `req.auth`. */
export function authJwt(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    next(new UnauthorizedError('Missing or invalid Authorization header'));
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    const payload = verifyAccessToken(token);
    req.auth = {
      userId: payload.userId,
      role: payload.role,
      organizationId: payload.organizationId,
      tokenType: 'jwt',
      scopes: [],
    };
    next();
  } catch {
    next(new UnauthorizedError('Invalid or expired token'));
  }
}
