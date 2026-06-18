import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { hashToken } from '../lib/apiToken';
import { UnauthorizedError } from '../errors/AppError';

/**
 * Authenticate a pull consumer (Astro build / WP plugin) via a read-only token.
 * Sets `req.auth` with the token's org + scopes (role null). tenantScope then
 * derives the tenant from organizationId.
 */
export async function authConsumerToken(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    next(new UnauthorizedError('Missing consumer token'));
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  const record = await prisma.apiToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.type !== 'CONSUMER' || record.organizationId == null) {
    next(new UnauthorizedError('Invalid consumer token'));
    return;
  }
  req.auth = {
    userId: null,
    role: null,
    organizationId: record.organizationId,
    tokenType: 'consumer',
    scopes: Array.isArray(record.scopes) ? (record.scopes as string[]) : [],
  };
  // Best-effort lastUsedAt update (don't block the request).
  void prisma.apiToken
    .updateMany({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
  next();
}
