import crypto from 'node:crypto';
import type { User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  NotFoundError,
  ConflictError,
  ForbiddenError,
  BadRequestError,
} from '../errors/AppError';
import { hashPassword } from '../lib/password';
import type { CreateUserInput, UpdateUserInput } from '../schemas/user';

// User is NOT tenant-scoped; org filtering is applied manually (admins see only own org).

function toPublic(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    organizationId: u.organizationId,
    createdAt: u.createdAt,
  };
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

export async function createUser(input: CreateUserInput, actorOrgId: number | null, isSuper: boolean) {
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

  const tempPassword = input.password ?? crypto.randomBytes(9).toString('base64url');
  const passwordHash = await hashPassword(tempPassword);
  const user = await prisma.user.create({
    data: { email: input.email, name: input.name, role, organizationId, passwordHash },
  });

  // Return the generated temp password once (so super_admin can share it).
  return { ...toPublic(user), ...(input.password ? {} : { tempPassword }) };
}

export async function updateUser(
  id: number,
  input: UpdateUserInput,
  actorOrgId: number | null,
  isSuper: boolean,
) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || (!isSuper && user.organizationId !== actorOrgId)) {
    throw new NotFoundError('User not found');
  }
  const data: Parameters<typeof prisma.user.update>[0]['data'] = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.role !== undefined) {
    if (!isSuper && input.role === 'SUPER_ADMIN') throw new ForbiddenError('Cannot grant super admin');
    data.role = input.role;
  }
  if (input.organizationId !== undefined && isSuper) data.organizationId = input.organizationId;
  if (input.password) data.passwordHash = await hashPassword(input.password);

  const updated = await prisma.user.update({ where: { id }, data });
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
  await prisma.user.delete({ where: { id } });
}
