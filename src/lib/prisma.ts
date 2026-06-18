import { PrismaClient, Prisma } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from '../config/env';

/**
 * 7-layer tenant isolation — Layer 3 (Prisma client extension).
 *
 * Every query against a tenant-scoped model MUST run inside a tenant context
 * (set via `withTenant`). The extension then auto-injects `organizationId` into
 * the WHERE clause (reads + filtered writes) and into the data (creates), so even
 * if a developer forgets the filter, cross-tenant access is impossible.
 *
 * Defensive rules also enforced here:
 *  - findUnique / findUniqueOrThrow are forbidden on tenant models (use findFirst
 *    with the auto-injected tenant filter — Layer 5: 404 not 403).
 *  - upsert is forbidden on tenant models (it cannot be safely auto-scoped through
 *    composite unique selectors — use findFirst + create/update instead).
 */

export interface TenantContext {
  /** The organization to scope queries to. `null` only valid together with isSuper. */
  tenantId: number | null;
  /** Super admins may run unscoped (cross-org) queries when tenantId is null. */
  isSuper: boolean;
}

export const tenantContext = new AsyncLocalStorage<TenantContext>();

/**
 * Run `fn` with a tenant context active. All tenant-scoped queries inside are
 * auto-filtered.
 *
 * NOTE: we `await fn()` *inside* the ALS scope. Prisma promises are lazy — their
 * execution (and our extension callback) fires when the promise is awaited. If we
 * returned the un-awaited promise, that execution would happen outside this scope
 * and lose the tenant context. Awaiting here keeps the context attached.
 */
export function withTenant<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  return tenantContext.run(ctx, async () => {
    return await fn();
  });
}

/** Models that carry an `organizationId` and must be tenant-filtered. */
const TENANT_SCOPED = new Set<string>(['Job', 'Review', 'Upload', 'SyncJob', 'AuditLog']);

/** Operations whose `where` clause should get the tenant filter injected. */
const WHERE_INJECT_OPS = new Set<string>([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);

/**
 * Operations that cannot be safely auto-scoped on tenant models:
 *  - findUnique/findUniqueOrThrow + upsert: take unique selectors that can't carry a
 *    loose organizationId filter.
 *  - single update/delete: same — their `where` is a unique selector. Services must use
 *    updateMany/deleteMany (which DO get the tenant filter) + a row-count check.
 */
const FORBIDDEN_OPS = new Set<string>([
  'findUnique',
  'findUniqueOrThrow',
  'upsert',
  'update',
  'delete',
]);

const basePrisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!model || !TENANT_SCOPED.has(model)) {
          return query(args);
        }

        const ctx = tenantContext.getStore();
        if (!ctx) {
          throw new Error(
            `Tenant isolation: ${model}.${operation} ran without a tenant context. ` +
              'Wrap the call in withTenant(...).',
          );
        }

        // Super admin with no specific org → unscoped (intentional cross-org access).
        if (ctx.isSuper && ctx.tenantId === null) {
          return query(args);
        }
        if (ctx.tenantId === null) {
          throw new Error(`Tenant isolation: no tenantId set for ${model}.${operation}.`);
        }
        const tenantId = ctx.tenantId;

        if (FORBIDDEN_OPS.has(operation)) {
          throw new Error(
            `Tenant isolation: ${operation} is not allowed on ${model}. ` +
              'Use findFirst / updateMany / deleteMany (auto tenant-filtered) instead.',
          );
        }

        const a = (args ?? {}) as Record<string, unknown>;

        if (WHERE_INJECT_OPS.has(operation)) {
          a.where = { ...((a.where as object) ?? {}), organizationId: tenantId };
        } else if (operation === 'create') {
          a.data = { ...((a.data as object) ?? {}), organizationId: tenantId };
        } else if (operation === 'createMany') {
          const data = a.data;
          a.data = Array.isArray(data)
            ? data.map((d) => ({ ...(d as object), organizationId: tenantId }))
            : { ...((data as object) ?? {}), organizationId: tenantId };
        }

        return query(a);
      },
    },
  },
});

export type ExtendedPrismaClient = typeof prisma;
export { Prisma };
