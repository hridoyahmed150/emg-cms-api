import type { Request, Response } from 'express';
import { validated } from '../middleware/validate';
import * as authService from '../services/auth.service';
import { verifyRefreshToken } from '../lib/jwt';
import { UnauthorizedError } from '../errors/AppError';
import { env } from '../config/env';
import type { LoginInput } from '../schemas/auth';

const REFRESH_COOKIE = 'emg_refresh';

const refreshCookieOpts = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/v1/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

export async function login(req: Request, res: Response): Promise<void> {
  const input = validated<LoginInput>(req, 'body');
  const { accessToken, refreshToken, user } = await authService.login(input);
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOpts);
  res.json({ accessToken, user });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!token) throw new UnauthorizedError('No refresh token');
  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }
  const { accessToken, user } = await authService.refresh(payload.userId);
  res.json({ accessToken, user });
}

export async function logout(_req: Request, res: Response): Promise<void> {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  res.json({ ok: true });
}

export async function me(req: Request, res: Response): Promise<void> {
  if (!req.auth?.userId) throw new UnauthorizedError();
  const user = await authService.getMe(req.auth.userId);
  res.json({ user });
}
