import { prisma } from '../lib/prisma';
import { NotFoundError } from '../errors/AppError';
import { generateConsumerToken } from '../lib/apiToken';
import type { CreateTokenInput } from '../schemas/token';

/**
 * ApiToken is NOT tenant-scoped by the Prisma extension, so org filtering is
 * applied manually here (mirrors how Organization/User are handled).
 */

export async function createConsumerToken(orgId: number, input: CreateTokenInput) {
  const { plaintext, hash } = generateConsumerToken();
  const token = await prisma.apiToken.create({
    data: {
      type: 'CONSUMER',
      organizationId: orgId,
      name: input.name,
      tokenHash: hash,
      scopes: input.scopes,
    },
  });
  // Plaintext token is returned ONCE here and never stored.
  return { id: token.id, name: token.name, scopes: token.scopes, type: token.type, token: plaintext };
}

export async function listTokens(orgId: number | null, isSuper: boolean) {
  const where = isSuper && orgId == null ? {} : { organizationId: orgId ?? -1 };
  const tokens = await prisma.apiToken.findMany({ where, orderBy: { createdAt: 'desc' } });
  return tokens.map((t) => ({
    id: t.id,
    type: t.type,
    name: t.name,
    scopes: t.scopes,
    organizationId: t.organizationId,
    lastUsedAt: t.lastUsedAt,
    createdAt: t.createdAt,
  }));
}

export async function revokeToken(orgId: number | null, isSuper: boolean, id: number) {
  const where = isSuper && orgId == null ? { id } : { id, organizationId: orgId ?? -1 };
  const res = await prisma.apiToken.deleteMany({ where });
  if (res.count === 0) throw new NotFoundError('Token not found');
}
