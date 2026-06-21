import type { Request, Response } from 'express';
import { validated } from '../middleware/validate';
import * as authService from '../services/auth.service';
import { verifyRefreshToken } from '../lib/jwt';
import { UnauthorizedError } from '../errors/AppError';
import { env } from '../config/env';
import type { LoginInput } from '../schemas/auth';

const REFRESH_COOKIE = 'emg_refresh';

// SameSite=None requires Secure (browsers reject None without it). Force Secure when
// SameSite=None (cross-site web↔API), else Secure only in production.
const refreshCookieOpts = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production' || env.COOKIE_SAMESITE === 'none',
  sameSite: env.COOKIE_SAMESITE,
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
  const { accessToken, user } = await authService.refresh(payload.userId, payload.tokenVersion);
  res.json({ accessToken, user });
}

export async function logout(_req: Request, res: Response): Promise<void> {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  res.json({ ok: true });
}

/**
 * Log out of ALL sessions/devices: invalidate every refresh token for the current user.
 * (Already-issued access tokens still work until they expire — see authService.bumpTokenVersion.)
 */
export async function logoutAll(req: Request, res: Response): Promise<void> {
  if (!req.auth?.userId) throw new UnauthorizedError();
  await authService.bumpTokenVersion(req.auth.userId);
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  res.json({ ok: true });
}

export async function me(req: Request, res: Response): Promise<void> {
  if (!req.auth?.userId) throw new UnauthorizedError();
  res.json(await authService.getMe(req.auth.userId));
}
