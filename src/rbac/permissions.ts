/**
 * Role-based access control — pure functions, no I/O.
 *
 * Roles mirror the `tenant_members.role` CHECK constraint in
 * supabase/migrations/00001_foundation.sql. Per-membership overrides live in
 * `tenant_members.extra_permissions` as `{ allow?: string[], deny?: string[] }`
 * and are applied deny-first (deny always wins over both allow and defaults).
 */
import { z } from 'zod';

export const PERMISSIONS = [
  // Bookings
  'bookings:create',
  'bookings:read',
  'bookings:update',
  'bookings:cancel',
  'bookings:assign',
  // Customers
  'customers:create',
  'customers:read',
  'customers:update',
  'customers:delete',
  // Services
  'services:create',
  'services:read',
  'services:update',
  'services:delete',
  // Branches
  'branches:create',
  'branches:read',
  'branches:update',
  'branches:deactivate',
  // Team / users
  'users:invite',
  'users:read',
  'users:update',
  'users:deactivate',
  // Settings
  'settings:read',
  'settings:update',
  // Reports
  'reports:read',
  'reports:export',
  // Payments
  'payments:record',
  'payments:refund',
  // Audit
  'audit:read',
  // Subscription / billing
  'subscription:read',
  'subscription:manage',
  // WhatsApp (Track K)
  'whatsapp:read',
  'whatsapp:send',
  'whatsapp:connect',
  'whatsapp:templates',
  // Reviews (Track N)
  'reviews:read',
  'reviews:respond',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = [
  'OWNER',
  'ADMIN',
  'MANAGER',
  'SUPERVISOR',
  'CLEANER',
  'DRIVER',
  'ACCOUNTANT',
  'CUSTOMER_SUPPORT',
] as const;

export type Role = (typeof ROLES)[number];

/** `'*'` grants every known permission. */
const ALL: readonly Permission[] = ['*'] as unknown as readonly Permission[];

export const ROLE_DEFAULTS: Record<Role, readonly Permission[]> = {
  OWNER: ALL,
  ADMIN: [
    'bookings:create',
    'bookings:read',
    'bookings:update',
    'bookings:cancel',
    'bookings:assign',
    'customers:create',
    'customers:read',
    'customers:update',
    'customers:delete',
    'services:create',
    'services:read',
    'services:update',
    'services:delete',
    'branches:create',
    'branches:read',
    'branches:update',
    'branches:deactivate',
    'users:invite',
    'users:read',
    'users:update',
    'users:deactivate',
    'settings:read',
    'settings:update',
    'reports:read',
    'reports:export',
    'payments:record',
    'payments:refund',
    'audit:read',
    'subscription:read',
    'whatsapp:read',
    'whatsapp:send',
    'whatsapp:connect',
    'whatsapp:templates',
    'reviews:read',
    'reviews:respond',
    // subscription:manage is OWNER-only (billing stays with the owner).
  ],
  MANAGER: [
    'bookings:create',
    'bookings:read',
    'bookings:update',
    'bookings:cancel',
    'bookings:assign',
    'customers:create',
    'customers:read',
    'customers:update',
    'services:create',
    'services:read',
    'services:update',
    'branches:read',
    'users:read',
    'settings:read',
    'reports:read',
    'reports:export',
    'payments:record',
    'subscription:read',
    'whatsapp:read',
    'whatsapp:send',
    'reviews:read',
    'reviews:respond',
  ],
  SUPERVISOR: [
    'bookings:create',
    'bookings:read',
    'bookings:update',
    'bookings:assign',
    'customers:read',
    'customers:update',
    'services:read',
    'branches:read',
    'reports:read',
    'whatsapp:read',
    'whatsapp:send',
    'reviews:read',
  ],
  CLEANER: [
    'bookings:read',
    'bookings:update',
    'customers:read',
    'services:read',
    'branches:read',
  ],
  DRIVER: [
    'bookings:read',
    'bookings:update',
    'customers:read',
    'services:read',
    'branches:read',
  ],
  ACCOUNTANT: [
    'bookings:read',
    'customers:read',
    'customers:update',
    'services:read',
    'branches:read',
    'settings:read',
    'reports:read',
    'reports:export',
    'payments:record',
    'payments:refund',
    'audit:read',
    'subscription:read',
    'reviews:read',
  ],
  CUSTOMER_SUPPORT: [
    'bookings:create',
    'bookings:read',
    'bookings:update',
    'customers:create',
    'customers:read',
    'customers:update',
    'services:read',
    'branches:read',
    'reports:read',
    'whatsapp:read',
    'whatsapp:send',
    'reviews:read',
  ],
};

/** Shape of `tenant_members.extra_permissions` overrides. */
export interface ExtraPermissions {
  allow?: readonly string[];
  deny?: readonly string[];
}

export function isRole(value: unknown): value is Role {
  return (
    typeof value === 'string' &&
    (ROLES as readonly string[]).includes(value)
  );
}

export function isPermission(value: unknown): value is Permission {
  return (
    typeof value === 'string' &&
    (PERMISSIONS as readonly string[]).includes(value)
  );
}

export const RoleSchema = z.enum(ROLES);
export const PermissionSchema = z.enum(PERMISSIONS);

/**
 * Resolves the full effective permission list for a role (wildcard expanded).
 * Suitable for client-side `includes()` gates; server enforcement must still
 * go through hasPermission()/requirePerm() with the member's extra overrides.
 */
export function permissionsForRole(role: string): readonly Permission[] {
  if (!isRole(role)) return [];
  const defaults = ROLE_DEFAULTS[role];
  if (defaults.includes('*' as Permission)) return [...PERMISSIONS];
  return [...defaults];
}

/** Shorthand for hasPermission() without per-membership overrides. */
export function can(role: string, permission: string): boolean {
  return hasPermission(role, permission);
}

export class PermissionDeniedError extends Error {
  readonly code = 'FORBIDDEN';
  readonly status = 403;
  readonly role: string;
  readonly permission: string;

  constructor(role: string, permission: string) {
    super(`Role '${role}' lacks permission '${permission}'.`);
    this.name = 'PermissionDeniedError';
    this.role = role;
    this.permission = permission;
  }
}

/**
 * Pure permission check. Deny-overrides take precedence:
 * extra.deny > extra.allow > role defaults. Unknown roles and unknown
 * permissions always return false (fail closed).
 */
export function hasPermission(
  role: string,
  permission: string,
  extra?: ExtraPermissions | null,
): boolean {
  if (!isPermission(permission)) return false;

  if (extra?.deny?.includes(permission)) return false;
  if (extra?.allow?.includes(permission)) return true;

  if (!isRole(role)) return false;
  const defaults = ROLE_DEFAULTS[role];
  return defaults.includes('*' as Permission) || defaults.includes(permission);
}

/**
 * Asserts a permission, throwing PermissionDeniedError when absent.
 * Use at the top of Server Actions / Route Handlers after resolving
 * the tenant context and membership role.
 */
export function requirePerm(
  role: string,
  permission: string,
  extra?: ExtraPermissions | null,
): void {
  if (!hasPermission(role, permission, extra)) {
    throw new PermissionDeniedError(role, permission);
  }
}
