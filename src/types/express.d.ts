import type { Role } from '@prisma/client';

/** The authenticated principal attached to a request (JWT user or consumer token). */
export interface AuthPrincipal {
  /** User id for JWT auth; null for CONSUMER (read-only) tokens. */
  userId: number | null;
  /** Role for JWT auth; null for CONSUMER tokens. */
  role: Role | null;
  /** Organization the principal belongs to; null only for SUPER_ADMIN. */
  organizationId: number | null;
  tokenType: 'jwt' | 'consumer';
  /** Granted permission scopes (used for consumer tokens). */
  scopes: string[];
}

declare global {
  namespace Express {
    interface Request {
      /** Set by auth middleware once the request is authenticated. */
      auth?: AuthPrincipal;
      /** Resolved tenant for this request (set by tenant middleware). */
      tenantId?: number | null;
      /** True when the principal is a SUPER_ADMIN acting unscoped. */
      isSuper?: boolean;
      /** Zod-parsed inputs (query is read-only in Express 5, so we store here). */
      validated?: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}

export {};
