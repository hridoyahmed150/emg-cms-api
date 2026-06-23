import type { User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { verifyPassword, hashPassword, DUMMY_PASSWORD_HASH } from '../lib/password';
import { signAccessToken, signRefreshToken } from '../lib/jwt';
import { UnauthorizedError } from '../errors/AppError';
import { logger } from '../lib/logger';
import { recordAudit } from './audit.service';
import type { LoginInput } from '../schemas/auth';

/** Shape returned to clients (never includes passwordHash). */
function toPublicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    organizationId: u.organizationId,
    mustChangePassword: u.mustChangePassword,
  };
}
export type PublicUser = ReturnType<typeof toPublicUser>;

export async function login(input: LoginInput) {
  // User is not tenant-scoped — safe to look up directly (no tenant context yet).
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Unknown email: still run a bcrypt compare against a dummy hash so this path takes
  // ~the same time as a real comparison (closes the user-enumeration timing channel).
  if (!user) {
    await verifyPassword(input.password, DUMMY_PASSWORD_HASH);
    await recordAudit({
      action: 'auth.login.failed',
      payload: { email: input.email, reason: 'unknown_email' },
    });
    throw new UnauthorizedError('Invalid credentials');
  }

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    await recordAudit({
      organizationId: user.organizationId,
      userId: user.id,
      action: 'auth.login.failed',
      payload: { reason: 'bad_password' },
    });
    throw new UnauthorizedError('Invalid credentials');
  }

  // Best-effort telemetry — must never fail an otherwise-valid login.
  try {
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  } catch (err) {
    logger.warn({ err, userId: user.id }, 'lastLoginAt update failed');
  }
  await recordAudit({ organizationId: user.organizationId, userId: user.id, action: 'auth.login' });

  const accessToken = signAccessToken({
    userId: user.id,
    role: user.role,
    organizationId: user.organizationId,
  });
  const refreshToken = signRefreshToken({ userId: user.id, tokenVersion: user.tokenVersion });
  return { accessToken, refreshToken, user: toPublicUser(user) };
}

export async function refresh(userId: number, tokenVersion: number) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new UnauthorizedError('User no longer exists');
  // Stale token version => the user changed password or logged out everywhere.
  if ((tokenVersion ?? 0) !== user.tokenVersion) {
    throw new UnauthorizedError('Session expired, please log in again');
  }
  const accessToken = signAccessToken({
    userId: user.id,
    role: user.role,
    organizationId: user.organizationId,
  });
  return { accessToken, user: toPublicUser(user) };
}

/**
 * Invalidate ALL of a user's existing refresh tokens by bumping tokenVersion.
 * Called on password change and on "log out everywhere".
 *
 * NOTE: access tokens are stateless and are NOT re-checked against tokenVersion (we avoid a
 * per-request DB read), so an already-issued access token keeps working until it expires
 * (JWT_ACCESS_TTL, default 15m). This bump stops the *refresh* chain, so any session ends
 * within one access-token lifetime. Keep JWT_ACCESS_TTL short for that reason.
 */
export async function bumpTokenVersion(userId: number): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
}

/**
 * Self-service password change. Verifies the current password, sets the new one, clears the
 * must-change flag, and bumps tokenVersion (logs out OTHER sessions/devices). Re-issues fresh
 * tokens for THIS session so the caller stays logged in (its old refresh token is now stale).
 */
export async function changePassword(userId: number, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new UnauthorizedError();

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) {
    await recordAudit({
      organizationId: user.organizationId,
      userId,
      action: 'auth.change_password.failed',
      payload: { reason: 'bad_current_password' },
    });
    throw new UnauthorizedError('Current password is incorrect');
  }

  const passwordHash = await hashPassword(newPassword);
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, mustChangePassword: false, tokenVersion: { increment: 1 } },
  });
  await recordAudit({ organizationId: user.organizationId, userId, action: 'auth.change_password' });

  const accessToken = signAccessToken({
    userId: updated.id,
    role: updated.role,
    organizationId: updated.organizationId,
  });
  const refreshToken = signRefreshToken({ userId: updated.id, tokenVersion: updated.tokenVersion });
  return { accessToken, refreshToken, user: toPublicUser(updated) };
}

export async function getMe(userId: number) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new UnauthorizedError();
  const organization = user.organizationId
    ? await prisma.organization.findUnique({ where: { id: user.organizationId } })
    : null;
  return { user: toPublicUser(user), organization };
}
