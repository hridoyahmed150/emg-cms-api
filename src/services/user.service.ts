import crypto from 'node:crypto';
import type { User } from '@prisma/client';
import { prisma, Prisma } from '../lib/prisma';
import {
  NotFoundError,
  ConflictError,
  ForbiddenError,
  BadRequestError,
} from '../errors/AppError';
import { hashPassword } from '../lib/password';
import { PasswordSchema } from '../schemas/password';
import { recordAudit } from './audit.service';
import type { CreateUserInput, UpdateUserInput } from '../schemas/user';

// User is NOT tenant-scoped; org filtering is applied manually (admins see only own org).
// NOTE: all routes are SUPER_ADMIN-only (requireSuperAdmin), so in practice isSuper is
// always true here; the non-super branches remain as defense-in-depth.

function toPublic(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    organizationId: u.organizationId,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

/** Generate a temp password that is guaranteed to satisfy PasswordSchema. */
function generateTempPassword(): string {
  for (let i = 0; i < 10; i++) {
    const candidate = crypto.randomBytes(12).toString('base64url');
    if (PasswordSchema.safeParse(candidate).success) return candidate;
  }
  // Deterministic fallback (upper+lower+digit, length >= 15) — always policy-compliant.
  return `Aa1${crypto.randomBytes(9).toString('base64url')}`;
}

export async function listUsers(scopeOrgId: number | null, isSuper: boolean) {
  const where = isSuper && scopeOrgId == null ? {} : { organizationId: scopeOrgId ?? -1 };
  const users = await prisma.user.findMany({ where, orderBy: { createdAt: 'desc' } });
  return users.map(toPublic);
}

export async function getUser(id: number, scopeOrgId: number | null, isSuper: boolean) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || (!isSuper && user.organizationId !== scopeOrgId)) {
    throw new NotFoundError('User not found'); // 404 across tenants, never reveal existence
  }
  return toPublic(user);
}

export async function createUser(
  input: CreateUserInput,
  actorOrgId: number | null,
  isSuper: boolean,
  actorUserId: number | null,
) {
  let role = input.role;
  let organizationId = input.organizationId ?? null;

  if (!isSuper) {
    if (role === 'SUPER_ADMIN') throw new ForbiddenError('Cannot create a super admin');
    organizationId = actorOrgId; // admins can only add users to their own org
  }
  if (role === 'SUPER_ADMIN') organizationId = null;
  if (role !== 'SUPER_ADMIN' && organizationId == null) {
    throw new BadRequestError('organizationId is required for non-super users');
  }

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new ConflictError('Email already in use');

  const tempPassword = input.password ?? generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  const user = await prisma.user.create({
    // A generated temp password must be changed by the user on first login; an explicit
    // admin-chosen password is taken as final.
    data: { email: input.email, name: input.name, role, organizationId, passwordHash, mustChangePassword: !input.password },
  });

  await recordAudit({
    organizationId: actorOrgId,
    userId: actorUserId,
    action: 'user.create',
    subjectType: 'User',
    subjectId: user.id,
    payload: { email: user.email, role: user.role, organizationId: user.organizationId },
  });

  // Return the generated temp password once (so the super admin can share it).
  return { ...toPublic(user), ...(input.password ? {} : { tempPassword }) };
}

export async function updateUser(
  id: number,
  input: UpdateUserInput,
  actorOrgId: number | null,
  isSuper: boolean,
  actorUserId: number | null,
) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || (!isSuper && user.organizationId !== actorOrgId)) {
    throw new NotFoundError('User not found');
  }

  const data: Parameters<typeof prisma.user.update>[0]['data'] = {};
  const changed: string[] = [];

  if (input.name !== undefined) {
    data.name = input.name;
    changed.push('name');
  }
  if (input.role !== undefined) {
    if (!isSuper && input.role === 'SUPER_ADMIN') throw new ForbiddenError('Cannot grant super admin');
    data.role = input.role;
    changed.push('role');
  }

  // Reconcile organizationId against the EFFECTIVE role so we never persist an
  // inconsistent (role, org) pair — e.g. a non-super user with a null org, which
  // tenantScope rejects (403 on every tenant route = a bricked account).
  const effectiveRole = input.role ?? user.role;
  let effectiveOrg =
    isSuper && input.organizationId !== undefined ? input.organizationId : user.organizationId;
  if (effectiveRole === 'SUPER_ADMIN') {
    effectiveOrg = null; // super admins are org-less (matches createUser's invariant)
  } else if (effectiveOrg == null) {
    throw new BadRequestError('organizationId is required when assigning a non-super role');
  }
  if (effectiveOrg !== user.organizationId) {
    data.organizationId = effectiveOrg;
    if (!changed.includes('organizationId')) changed.push('organizationId');
  }

  if (input.password) {
    data.passwordHash = await hashPassword(input.password);
    // Changing the password invalidates all existing refresh tokens for this user.
    data.tokenVersion = { increment: 1 };
    // Admin-reset password → the user must set their own on next login.
    data.mustChangePassword = true;
    changed.push('password');
  }

  // Demoting a SUPER_ADMIN must be atomic with the "is this the last one?" check, or two
  // concurrent demotions could each pass the guard and strand the platform at 0 super admins.
  const isDemotingSuper = user.role === 'SUPER_ADMIN' && effectiveRole !== 'SUPER_ADMIN';
  const updated = await prisma.$transaction(
    async (tx) => {
      if (isDemotingSuper) {
        const others = await tx.user.count({ where: { role: 'SUPER_ADMIN', id: { not: id } } });
        if (others < 1) throw new BadRequestError('Cannot demote the last super admin');
      }
      return tx.user.update({ where: { id }, data });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  await recordAudit({
    organizationId: actorOrgId,
    userId: actorUserId,
    action: 'user.update',
    subjectType: 'User',
    subjectId: updated.id,
    payload: { changed },
  });

  return toPublic(updated);
}

export async function deleteUser(
  id: number,
  actorOrgId: number | null,
  isSuper: boolean,
  actorUserId: number | null,
) {
  if (actorUserId != null && id === actorUserId) {
    throw new BadRequestError('You cannot delete your own account');
  }
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || (!isSuper && user.organizationId !== actorOrgId)) {
    throw new NotFoundError('User not found');
  }

  // Atomic last-super-admin guard (see updateUser) — re-check inside a serializable tx so
  // concurrent deletes can't both slip past and leave the platform with zero super admins.
  await prisma.$transaction(
    async (tx) => {
      if (user.role === 'SUPER_ADMIN') {
        const others = await tx.user.count({ where: { role: 'SUPER_ADMIN', id: { not: id } } });
        if (others < 1) throw new BadRequestError('Cannot delete the last super admin');
      }
      await tx.user.delete({ where: { id } });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  await recordAudit({
    organizationId: actorOrgId,
    userId: actorUserId,
    action: 'user.delete',
    subjectType: 'User',
    subjectId: id,
    payload: { email: user.email, role: user.role },
  });
}
