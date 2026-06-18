import type { Role } from '@prisma/client';

/**
 * Extensible, permission-based access control. Adding a role later = add a key
 * here (+ the Role enum) — no route/controller changes needed.
 */
export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  SUPER_ADMIN: ['*'],
  ADMIN: [
    'jobs:read',
    'jobs:write',
    'jobs:delete',
    'reviews:read',
    'reviews:write',
    'reviews:delete',
    'uploads:read',
    'uploads:write',
    'uploads:delete',
    'users:read:own_org',
    'users:write:own_org',
    'organization:read:own',
    'organization:write:own',
    'delivery:read:own',
    'delivery:retry:own',
    'tokens:read:own',
    'tokens:write:own',
  ],
  // EDITOR: ['jobs:read','jobs:write','reviews:read','reviews:write'],  // future
};

export function hasPermission(role: Role, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[role] ?? [];
  return perms.includes('*') || perms.includes(permission);
}

/**
 * Permission check for any principal: role-based for JWT users, explicit-scope
 * based for consumer (read-only) API tokens.
 */
export function principalHasPermission(
  principal: { role: Role | null; scopes: string[] },
  permission: string,
): boolean {
  if (principal.role) return hasPermission(principal.role, permission);
  return principal.scopes.includes('*') || principal.scopes.includes(permission);
}
