import { describe, expect, it } from 'vitest';

import {
  PERMISSIONS,
  PermissionDeniedError,
  ROLE_DEFAULTS,
  ROLES,
  hasPermission,
  isPermission,
  isRole,
  requirePerm,
} from '../src/rbac/permissions';

describe('role / permission guards', () => {
  it('recognises every defined role and permission', () => {
    for (const role of ROLES) expect(isRole(role)).toBe(true);
    for (const perm of PERMISSIONS) expect(isPermission(perm)).toBe(true);
    expect(isRole('SUPERADMIN')).toBe(false);
    expect(isRole('owner')).toBe(false);
    expect(isPermission('bookings:destroy')).toBe(false);
    expect(isPermission('*')).toBe(false);
  });

  it('exposes ~30 phase-1 permissions', () => {
    expect(PERMISSIONS.length).toBeGreaterThanOrEqual(28);
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it('defines defaults for every role', () => {
    expect(Object.keys(ROLE_DEFAULTS).sort()).toEqual([...ROLES].sort());
  });
});

describe('hasPermission matrix', () => {
  it('grants OWNER everything via wildcard', () => {
    for (const perm of PERMISSIONS) {
      expect(hasPermission('OWNER', perm)).toBe(true);
    }
  });

  it('keeps subscription:manage OWNER-only', () => {
    expect(hasPermission('OWNER', 'subscription:manage')).toBe(true);
    for (const role of ROLES.filter((r) => r !== 'OWNER')) {
      expect(hasPermission(role, 'subscription:manage')).toBe(false);
    }
  });

  it('lets field staff update assigned bookings but not cancel or manage billing', () => {
    for (const role of ['CLEANER', 'DRIVER'] as const) {
      expect(hasPermission(role, 'bookings:read')).toBe(true);
      expect(hasPermission(role, 'bookings:update')).toBe(true);
      expect(hasPermission(role, 'bookings:cancel')).toBe(false);
      expect(hasPermission(role, 'bookings:assign')).toBe(false);
      expect(hasPermission(role, 'payments:refund')).toBe(false);
      expect(hasPermission(role, 'settings:update')).toBe(false);
    }
  });

  it('lets MANAGER run operations but not manage team billing or audit', () => {
    expect(hasPermission('MANAGER', 'bookings:assign')).toBe(true);
    expect(hasPermission('MANAGER', 'reports:export')).toBe(true);
    expect(hasPermission('MANAGER', 'users:invite')).toBe(false);
    expect(hasPermission('MANAGER', 'settings:update')).toBe(false);
    expect(hasPermission('MANAGER', 'audit:read')).toBe(false);
    expect(hasPermission('MANAGER', 'payments:refund')).toBe(false);
    expect(hasPermission('MANAGER', 'customers:delete')).toBe(false);
  });

  it('scopes ACCOUNTANT to money, reports and read-only operations', () => {
    expect(hasPermission('ACCOUNTANT', 'payments:record')).toBe(true);
    expect(hasPermission('ACCOUNTANT', 'payments:refund')).toBe(true);
    expect(hasPermission('ACCOUNTANT', 'reports:export')).toBe(true);
    expect(hasPermission('ACCOUNTANT', 'audit:read')).toBe(true);
    expect(hasPermission('ACCOUNTANT', 'bookings:create')).toBe(false);
    expect(hasPermission('ACCOUNTANT', 'settings:update')).toBe(false);
    expect(hasPermission('ACCOUNTANT', 'users:invite')).toBe(false);
  });

  it('scopes CUSTOMER_SUPPORT to front-desk work', () => {
    expect(hasPermission('CUSTOMER_SUPPORT', 'customers:create')).toBe(true);
    expect(hasPermission('CUSTOMER_SUPPORT', 'bookings:create')).toBe(true);
    expect(hasPermission('CUSTOMER_SUPPORT', 'bookings:cancel')).toBe(false);
    expect(hasPermission('CUSTOMER_SUPPORT', 'payments:record')).toBe(false);
    expect(hasPermission('CUSTOMER_SUPPORT', 'reports:export')).toBe(false);
  });

  it('scopes SUPERVISOR between manager and field staff', () => {
    expect(hasPermission('SUPERVISOR', 'bookings:assign')).toBe(true);
    expect(hasPermission('SUPERVISOR', 'customers:update')).toBe(true);
    expect(hasPermission('SUPERVISOR', 'bookings:cancel')).toBe(false);
    expect(hasPermission('SUPERVISOR', 'services:create')).toBe(false);
    expect(hasPermission('SUPERVISOR', 'users:invite')).toBe(false);
  });

  it('fails closed for unknown roles and unknown permissions', () => {
    expect(hasPermission('SUPERADMIN', 'bookings:read')).toBe(false);
    expect(hasPermission('', 'bookings:read')).toBe(false);
    expect(hasPermission('OWNER', 'bookings:destroy')).toBe(false);
    expect(hasPermission('ADMIN', '')).toBe(false);
  });
});

describe('extra_permissions overrides', () => {
  it('allow grants a permission the role lacks', () => {
    expect(
      hasPermission('CLEANER', 'bookings:cancel', {
        allow: ['bookings:cancel'],
      }),
    ).toBe(true);
  });

  it('deny revokes a permission the role has (deny wins over allow)', () => {
    expect(
      hasPermission('MANAGER', 'payments:record', {
        deny: ['payments:record'],
      }),
    ).toBe(false);
    expect(
      hasPermission('MANAGER', 'payments:record', {
        allow: ['payments:record'],
        deny: ['payments:record'],
      }),
    ).toBe(false);
  });

  it('ignores unknown permissions inside overrides', () => {
    expect(
      hasPermission('CLEANER', 'bookings:destroy', {
        allow: ['bookings:destroy'],
      }),
    ).toBe(false);
  });

  it('tolerates null / empty overrides', () => {
    expect(hasPermission('CLEANER', 'bookings:read', null)).toBe(true);
    expect(hasPermission('CLEANER', 'bookings:read', {})).toBe(true);
  });
});

describe('requirePerm', () => {
  it('passes silently when allowed', () => {
    expect(() =>
      requirePerm('ADMIN', 'users:invite'),
    ).not.toThrow();
  });

  it('throws PermissionDeniedError with role context when denied', () => {
    try {
      requirePerm('CLEANER', 'users:invite');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PermissionDeniedError);
      const denied = error as PermissionDeniedError;
      expect(denied.code).toBe('FORBIDDEN');
      expect(denied.status).toBe(403);
      expect(denied.role).toBe('CLEANER');
      expect(denied.permission).toBe('users:invite');
    }
  });

  it('honours overrides', () => {
    expect(() =>
      requirePerm('CLEANER', 'bookings:cancel', {
        allow: ['bookings:cancel'],
      }),
    ).not.toThrow();
    expect(() =>
      requirePerm('ADMIN', 'users:invite', { deny: ['users:invite'] }),
    ).toThrow(PermissionDeniedError);
  });
});
