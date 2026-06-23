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
    // User management is SUPER_ADMIN-only (no 'users:*' here) — enforced by requireSuperAdmin in user.routes.ts.
    'organization:read:own',
    'organization:write:own',
    'delivery:read:own',
    'delivery:retry:own',
    'delivery:publish:own',
    // API tokens are SUPER_ADMIN-only (consumer read tokens are an agency-side onboarding
    // concern, not a client task) — no 'tokens:*' here; enforced by requireSuperAdmin in token.routes.ts.
  ],
  // EDITOR: ['jobs:read','jobs:write','reviews:read','reviews:write'],  // future
};

/**
 * Human-readable permission catalog for the dashboard's read-only permissions view.
 * `key` matches the strings in ROLE_PERMISSIONS; SUPER_ADMIN holds the `*` wildcard
 * (full access) and is rendered specially in the UI. Editing permissions per-user is
 * intentionally out of scope for now (display-only).
 */
export interface PermissionInfo {
  key: string;
  label: string;
  group: string;
}

export const PERMISSION_CATALOG: PermissionInfo[] = [
  { key: 'jobs:read', label: 'View jobs', group: 'Jobs' },
  { key: 'jobs:write', label: 'Create & edit jobs', group: 'Jobs' },
  { key: 'jobs:delete', label: 'Delete jobs', group: 'Jobs' },
  { key: 'reviews:read', label: 'View reviews', group: 'Reviews' },
  { key: 'reviews:write', label: 'Create, edit & refresh reviews', group: 'Reviews' },
  { key: 'reviews:delete', label: 'Delete reviews', group: 'Reviews' },
  { key: 'uploads:read', label: 'View uploads', group: 'Uploads' },
  { key: 'uploads:write', label: 'Upload files', group: 'Uploads' },
  { key: 'uploads:delete', label: 'Delete uploads', group: 'Uploads' },
  { key: 'users:read', label: 'View users', group: 'Users (super admin only)' },
  { key: 'users:write', label: 'Create & edit users', group: 'Users (super admin only)' },
  { key: 'users:delete', label: 'Delete users', group: 'Users (super admin only)' },
  { key: 'organization:read:own', label: 'View organization', group: 'Organization' },
  { key: 'organization:write:own', label: 'Edit organization', group: 'Organization' },
  { key: 'delivery:read:own', label: 'View delivery jobs', group: 'Delivery' },
  { key: 'delivery:retry:own', label: 'Retry delivery', group: 'Delivery' },
  { key: 'delivery:publish:own', label: 'Publish to site', group: 'Delivery' },
  { key: 'tokens:read', label: 'View API tokens', group: 'API tokens (super admin only)' },
  { key: 'tokens:write', label: 'Manage API tokens', group: 'API tokens (super admin only)' },
];

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
