import { prisma, withTenant, Prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export interface AuditEntry {
  /** Org the action belongs to. null = global / cross-org (e.g. super-admin or pre-auth). */
  organizationId?: number | null;
  /** Actor who performed the action (the authenticated user), if known. */
  userId?: number | null;
  action: string; // e.g. 'auth.login', 'user.create'
  subjectType?: string; // e.g. 'User'
  subjectId?: number;
  payload?: Record<string, unknown>;
}

/**
 * Append a row to the AuditLog. AuditLog is tenant-scoped, so the write runs inside a
 * tenant context: a concrete `organizationId` scopes it to that org; a null org is
 * treated as a global entry (isSuper=true) so login (which has no tenant context yet)
 * and super-admin (org-less) actions don't trip the "no tenant context" guard.
 *
 * Audit must never break the request it describes — failures are logged and swallowed.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  const organizationId = entry.organizationId ?? null;
  try {
    await withTenant({ tenantId: organizationId, isSuper: organizationId == null }, () =>
      prisma.auditLog.create({
        data: {
          organizationId,
          userId: entry.userId ?? null,
          action: entry.action,
          subjectType: entry.subjectType ?? null,
          subjectId: entry.subjectId ?? null,
          payload: (entry.payload ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      }),
    );
  } catch (err) {
    logger.warn({ err, action: entry.action }, 'audit write failed');
  }
}
