import type { User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { verifyPassword } from '../lib/password';
import { signAccessToken, signRefreshToken } from '../lib/jwt';
import { UnauthorizedError } from '../errors/AppError';
import type { LoginInput } from '../schemas/auth';

/** Shape returned to clients (never includes passwordHash). */
function toPublicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    organizationId: u.organizationId,
  };
}
export type PublicUser = ReturnType<typeof toPublicUser>;

export async function login(input: LoginInput) {
  // User is not tenant-scoped — safe to look up directly (no tenant context yet).
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Constant-ish failure path: same error whether user missing or password wrong.
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new UnauthorizedError('Invalid credentials');
  }
  const accessToken = signAccessToken({
    userId: user.id,
    role: user.role,
    organizationId: user.organizationId,
  });
  const refreshToken = signRefreshToken({ userId: user.id });
  return { accessToken, refreshToken, user: toPublicUser(user) };
}

export async function refresh(userId: number) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new UnauthorizedError('User no longer exists');
  const accessToken = signAccessToken({
    userId: user.id,
    role: user.role,
    organizationId: user.organizationId,
  });
  return { accessToken, user: toPublicUser(user) };
}

export async function getMe(userId: number) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new UnauthorizedError();
  const organization = user.organizationId
    ? await prisma.organization.findUnique({ where: { id: user.organizationId } })
    : null;
  return { user: toPublicUser(user), organization };
}
