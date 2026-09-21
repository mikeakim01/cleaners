import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  TenantAccessDeniedError,
  assertTenantAccess,
  resolveTenant,
  withTenantContext,
  type TenantMembership,
} from '../src/server/tenant-context';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = fs.readFileSync(
  path.join(testDir, '..', 'supabase', 'migrations', '00001_foundation.sql'),
  'utf8',
);

function createdTables(sql: string): string[] {
  return [
    ...sql.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g),
  ].map((m) => m[1] as string);
}

function tenantIsolationPolicies(sql: string): Map<string, string> {
  const policies = new Map<string, string>();
  const re =
    /CREATE POLICY "tenant_isolation" ON public\.(\w+)[\s\S]*?USING \(([\s\S]*?)\)\s*WITH CHECK \(([\s\S]*?)\)\s*;/g;
  for (const m of sql.matchAll(re)) {
    policies.set(m[1] as string, `${m[2]} ${m[3]}`);
  }
  return policies;
}

const CORE_CRM_SQL = fs.readFileSync(
  path.join(testDir, '..', 'supabase', 'migrations', '00002_core_crm.sql'),
  'utf8',
);

const FINANCIAL_SQL = fs.readFileSync(
  path.join(testDir, '..', 'supabase', 'migrations', '00003_financial.sql'),
  'utf8',
);

const WHATSAPP_SQL = fs.readFileSync(
  path.join(testDir, '..', 'supabase', 'migrations', '00004_whatsapp.sql'),
  'utf8',
);

const PORTAL_SQL = fs.readFileSync(
  path.join(testDir, '..', 'supabase', 'migrations', '00005_portal.sql'),
  'utf8',
);

const BILLING_SQL = fs.readFileSync(
  path.join(testDir, '..', 'supabase', 'migrations', '00006_billing.sql'),
  'utf8',
);

const CLEANER_SQL = fs.readFileSync(
  path.join(testDir, '..', 'supabase', 'migrations', '00007_cleaner.sql'),
  'utf8',
);

/** Phase 2 tenant tables: every one must carry tenant_id + isolation policy. */
const CORE_CRM_TABLES = [
  'customers',
  'services',
  'bookings',
  'quotes',
  'quote_items',
  'employees',
  'teams',
  'team_members',
  'jobs',
  'job_assignments',
  'availability_slots',
] as const;
const TENANT_TABLES = [
  'tenant_members',
  'business_settings',
  'branches',
  'subscriptions',
  'usage_counters',
  'audit_logs',
] as const;

describe('migration: tenant isolation policies', () => {
  it('creates every expected tenant table', () => {
    const tables = createdTables(MIGRATION_SQL);
    for (const table of [...TENANT_TABLES, 'tenants', 'plans', 'profiles']) {
      expect(tables, `missing CREATE TABLE ${table}`).toContain(table);
    }
  });

  it('defines a tenant_isolation policy for every tenant table', () => {
    const policies = tenantIsolationPolicies(MIGRATION_SQL);
    for (const table of TENANT_TABLES) {
      expect(
        policies.has(table),
        `missing CREATE POLICY tenant_isolation on ${table}`,
      ).toBe(true);
    }
  });

  it('creates every Phase 2 core-CRM table with an isolation policy', () => {
    const tables = createdTables(CORE_CRM_SQL);
    const policies = tenantIsolationPolicies(CORE_CRM_SQL);
    for (const table of CORE_CRM_TABLES) {
      expect(tables, `missing CREATE TABLE ${table}`).toContain(table);
      expect(
        policies.has(table),
        `missing CREATE POLICY tenant_isolation on ${table}`,
      ).toBe(true);
      const body = policies.get(table) ?? '';
      expect(body, `${table}: must scope on tenant_id`).toContain('tenant_id');
      expect(body, `${table}: must read app.current_tenant`).toContain(
        "current_setting('app.current_tenant'",
      );
      expect(body, `${table}: must check membership`).toContain(
        'public.is_tenant_member',
      );
    }
  });

  it('forces RLS on every Phase 2 core-CRM table', () => {
    const forced = new Set(
      [...CORE_CRM_SQL.matchAll(
        /ALTER TABLE public\.(\w+) FORCE ROW LEVEL SECURITY/g,
      )].map((m) => m[1]),
    );
    const enabled = new Set(
      [...CORE_CRM_SQL.matchAll(
        /ALTER TABLE public\.(\w+) ENABLE ROW LEVEL SECURITY/g,
      )].map((m) => m[1]),
    );
    for (const table of CORE_CRM_TABLES) {
      expect(enabled, `${table} must ENABLE RLS`).toContain(table);
      expect(forced, `${table} must FORCE RLS`).toContain(table);
    }
  });

  it('creates every Phase 3 financial table with isolation + FORCE RLS', () => {    const tables = createdTables(FINANCIAL_SQL);
    const policies = tenantIsolationPolicies(FINANCIAL_SQL);
    const forced = new Set(
      [...FINANCIAL_SQL.matchAll(
        /ALTER TABLE public\.(\w+) FORCE ROW LEVEL SECURITY/g,
      )].map((m) => m[1]),
    );
    const enabled = new Set(
      [...FINANCIAL_SQL.matchAll(
        /ALTER TABLE public\.(\w+) ENABLE ROW LEVEL SECURITY/g,
      )].map((m) => m[1]),
    );
    for (const table of ['invoices', 'invoice_items', 'payments'] as const) {
      expect(tables, `missing CREATE TABLE ${table}`).toContain(table);
      expect(
        policies.has(table),
        `missing CREATE POLICY tenant_isolation on ${table}`,
      ).toBe(true);
      const body = policies.get(table) ?? '';
      expect(body, `${table}: must scope on tenant_id`).toContain('tenant_id');
      expect(body, `${table}: must read app.current_tenant`).toContain(
        "current_setting('app.current_tenant'",
      );
      expect(body, `${table}: must check membership`).toContain(
        'public.is_tenant_member',
      );
      expect(enabled, `${table} must ENABLE RLS`).toContain(table);
      expect(forced, `${table} must FORCE RLS`).toContain(table);
    }
  });

  it('creates every Phase 4 WhatsApp table with isolation + FORCE RLS', () => {
    const tables = createdTables(WHATSAPP_SQL);
    const policies = tenantIsolationPolicies(WHATSAPP_SQL);
    const forced = new Set(
      [...WHATSAPP_SQL.matchAll(
        /ALTER TABLE public\.(\w+) FORCE ROW LEVEL SECURITY/g,
      )].map((m) => m[1]),
    );
    const enabled = new Set(
      [...WHATSAPP_SQL.matchAll(
        /ALTER TABLE public\.(\w+) ENABLE ROW LEVEL SECURITY/g,
      )].map((m) => m[1]),
    );
    for (const table of [
      'whatsapp_accounts',
      'whatsapp_templates',
      'whatsapp_conversations',
      'whatsapp_messages',
      'whatsapp_automation_rules',
    ] as const) {
      expect(tables, `missing CREATE TABLE ${table}`).toContain(table);
      expect(
        policies.has(table),
        `missing CREATE POLICY tenant_isolation on ${table}`,
      ).toBe(true);
      const wbody = policies.get(table) ?? '';
      expect(wbody, `${table}: must scope on tenant_id`).toContain('tenant_id');
      expect(wbody, `${table}: must read app.current_tenant`).toContain(
        "current_setting('app.current_tenant'",
      );
      expect(wbody, `${table}: must check membership`).toContain(
        'public.is_tenant_member',
      );
      expect(enabled, `${table} must ENABLE RLS`).toContain(table);
      expect(forced, `${table} must FORCE RLS`).toContain(table);
    }
  });

  it('creates every Phase 5 portal table with isolation + FORCE RLS', () => {
    const tables = createdTables(PORTAL_SQL);
    const policies = tenantIsolationPolicies(PORTAL_SQL);
    const forced = new Set(
      [...PORTAL_SQL.matchAll(
        /ALTER TABLE public\.(\w+) FORCE ROW LEVEL SECURITY/g,
      )].map((m) => m[1]),
    );
    const enabled = new Set(
      [...PORTAL_SQL.matchAll(
        /ALTER TABLE public\.(\w+) ENABLE ROW LEVEL SECURITY/g,
      )].map((m) => m[1]),
    );
    for (const table of ['reviews', 'customer_access_codes'] as const) {
      expect(tables, `missing CREATE TABLE ${table}`).toContain(table);
      expect(
        policies.has(table),
        `missing CREATE POLICY tenant_isolation on ${table}`,
      ).toBe(true);
      const pbody = policies.get(table) ?? '';
      expect(pbody, `${table}: must scope on tenant_id`).toContain('tenant_id');
      expect(pbody, `${table}: must read app.current_tenant`).toContain(
        "current_setting('app.current_tenant'",
      );
      expect(pbody, `${table}: must check membership`).toContain(
        'public.is_tenant_member',
      );
      expect(enabled, `${table} must ENABLE RLS`).toContain(table);
      expect(forced, `${table} must FORCE RLS`).toContain(table);
    }
  });

  it('creates the Phase 6 subscription_events table with isolation + FORCE RLS', () => {
    const tables = createdTables(BILLING_SQL);
    const policies = tenantIsolationPolicies(BILLING_SQL);
    const forced = new Set(
      [...BILLING_SQL.matchAll(
        /ALTER TABLE public\.(\w+) FORCE ROW LEVEL SECURITY/g,
      )].map((m) => m[1]),
    );
    const enabled = new Set(
      [...BILLING_SQL.matchAll(
        /ALTER TABLE public\.(\w+) ENABLE ROW LEVEL SECURITY/g,
      )].map((m) => m[1]),
    );
    expect(tables, 'missing CREATE TABLE subscription_events').toContain('subscription_events');
    expect(
      policies.has('subscription_events'),
      'missing CREATE POLICY tenant_isolation on subscription_events',
    ).toBe(true);
    const bbody = policies.get('subscription_events') ?? '';
    expect(bbody).toContain('tenant_id');
    expect(bbody).toContain("current_setting('app.current_tenant'");
    expect(bbody).toContain('public.is_tenant_member');
    expect(enabled, 'subscription_events must ENABLE RLS').toContain('subscription_events');
    expect(forced, 'subscription_events must FORCE RLS').toContain('subscription_events');
  });

  it('restricts platform tables to super-admins', () => {
    expect(BILLING_SQL).toMatch(/CREATE POLICY "platform_admin_only" ON public\.platform_audit_logs/);
    expect(BILLING_SQL).toMatch(/CREATE POLICY "platform_admin_only" ON public\.feature_flags/);
    expect(BILLING_SQL).toMatch(/is_super_admin\(\)/);
    expect(BILLING_SQL).not.toMatch(/CREATE POLICY "tenant_isolation" ON public\.platform_audit_logs/);
  });

  it('creates the Phase 7 files table with isolation + FORCE RLS', () => {
    const tables = createdTables(CLEANER_SQL);
    const policies = tenantIsolationPolicies(CLEANER_SQL);
    expect(tables, 'missing CREATE TABLE files').toContain('files');
    expect(
      policies.has('files'),
      'missing CREATE POLICY tenant_isolation on files',
    ).toBe(true);
    const fbody = policies.get('files') ?? '';
    expect(fbody).toContain('tenant_id');
    expect(fbody).toContain("current_setting('app.current_tenant'");
    expect(fbody).toContain('public.is_tenant_member');
    expect(
      [...CLEANER_SQL.matchAll(/ALTER TABLE public\.(\w+) ENABLE ROW LEVEL SECURITY/g)].map((m) => m[1]),
      'files must ENABLE RLS',
    ).toContain('files');
    expect(
      [...CLEANER_SQL.matchAll(/ALTER TABLE public\.(\w+) FORCE ROW LEVEL SECURITY/g)].map((m) => m[1]),
      'files must FORCE RLS',
    ).toContain('files');
  });

  it('keys every isolation policy on the request tenant plus membership', () => {
    const policies = tenantIsolationPolicies(MIGRATION_SQL);
    for (const table of TENANT_TABLES) {
      const body = policies.get(table) ?? '';
      expect(body, `${table}: must scope on tenant_id`).toContain('tenant_id');
      expect(body, `${table}: must read app.current_tenant`).toContain(
        "current_setting('app.current_tenant'",
      );
      expect(body, `${table}: must check membership`).toContain(
        'public.is_tenant_member',
      );
    }
  });

  it('self-scopes the tenants table on id with the same guard', () => {
    const policies = tenantIsolationPolicies(MIGRATION_SQL);
    expect(policies.has('tenants')).toBe(true);
    const body = policies.get('tenants') ?? '';
    expect(body).toContain('public.is_tenant_member(id)');
  });

  it('enables RLS everywhere and forces it on tenant tables', () => {
    const forced = new Set(
      [...MIGRATION_SQL.matchAll(
        /ALTER TABLE public\.(\w+) FORCE ROW LEVEL SECURITY/g,
      )].map((m) => m[1]),
    );
    const enabled = new Set(
      [...MIGRATION_SQL.matchAll(
        /ALTER TABLE public\.(\w+) ENABLE ROW LEVEL SECURITY/g,
      )].map((m) => m[1]),
    );
    // tenant_members is ENABLE-only by design: FORCE would recurse through
    // is_tenant_member() (documented in the migration header).
    for (const table of TENANT_TABLES.filter((t) => t !== 'tenant_members')) {
      expect(enabled, `${table} must ENABLE RLS`).toContain(table);
      expect(forced, `${table} must FORCE RLS`).toContain(table);
    }
    expect(enabled, 'tenant_members must ENABLE RLS').toContain(
      'tenant_members',
    );
    expect(MIGRATION_SQL).toMatch(/SECURITY DEFINER[\s\S]{0,200}tenant_members/);
  });

  it('keeps plans and profiles readable without leaking writes', () => {
    expect(MIGRATION_SQL).toMatch(/CREATE POLICY "plans_readable" ON public\.plans/);
    expect(MIGRATION_SQL).toMatch(
      /CREATE POLICY "profiles_owner_read" ON public\.profiles/,
    );
    expect(MIGRATION_SQL).toMatch(
      /CREATE POLICY "profiles_owner_write" ON public\.profiles/,
    );
  });

  it('defines the is_tenant_member helper as SECURITY DEFINER', () => {
    expect(MIGRATION_SQL).toMatch(
      /CREATE OR REPLACE FUNCTION public\.is_tenant_member\([^)]*uuid\)[\s\S]*?SECURITY DEFINER/,
    );
  });
});

const MEMBERSHIPS: TenantMembership[] = [
  { tenant_id: '11111111-1111-4111-8111-111111111111', role: 'OWNER' },
  { tenant_id: '22222222-2222-4222-8222-222222222222', role: 'CLEANER' },
];

describe('assertTenantAccess (pure)', () => {
  it('accepts a requested tenant the user belongs to', () => {
    const m = assertTenantAccess(
      MEMBERSHIPS,
      '22222222-2222-4222-8222-222222222222',
    );
    expect(m.role).toBe('CLEANER');
  });

  it('rejects a client-supplied tenant the user does not belong to', () => {
    expect(() =>
      assertTenantAccess(MEMBERSHIPS, '33333333-3333-4333-8333-333333333333'),
    ).toThrow(TenantAccessDeniedError);
  });

  it('rejects users with no memberships', () => {
    expect(() => assertTenantAccess([], undefined)).toThrow(
      TenantAccessDeniedError,
    );
  });

  it('requires an explicit choice for multi-tenant users', () => {
    expect(() => assertTenantAccess(MEMBERSHIPS, undefined)).toThrow(
      TenantAccessDeniedError,
    );
  });

  it('defaults single-tenant users to their only tenant', () => {
    const m = assertTenantAccess([MEMBERSHIPS[0] as TenantMembership], undefined);
    expect(m.tenant_id).toBe('11111111-1111-4111-8111-111111111111');
  });
});

describe('resolveTenant / withTenantContext', () => {
  const stubProvider = {
    listMemberships: async () => MEMBERSHIPS,
  };
  const USER_ID = '99999999-9999-4999-8999-999999999999';

  it('resolves the verified tenant context for a member', async () => {
    const ctx = await resolveTenant(
      {
        userId: USER_ID,
        requestedTenantId: '11111111-1111-4111-8111-111111111111',
      },
      stubProvider,
    );
    expect(ctx).toEqual({
      tenantId: '11111111-1111-4111-8111-111111111111',
      userId: USER_ID,
      role: 'OWNER',
    });
  });

  it('rejects a mismatched client-supplied tenant id', async () => {
    await expect(
      resolveTenant(
        {
          userId: USER_ID,
          requestedTenantId: '33333333-3333-4333-8333-333333333333',
        },
        stubProvider,
      ),
    ).rejects.toBeInstanceOf(TenantAccessDeniedError);
  });

  it('rejects malformed UUID input instead of querying', async () => {
    const spy = { calls: 0, listMemberships: async () => {
      spy.calls += 1;
      return MEMBERSHIPS;
    } };
    await expect(
      resolveTenant({ userId: 'not-a-uuid' }, spy),
    ).rejects.toBeInstanceOf(TenantAccessDeniedError);
    expect(spy.calls).toBe(0);
  });

  it('withTenantContext runs the callback with the verified context', async () => {
    const result = await withTenantContext(
      {
        userId: USER_ID,
        requestedTenantId: '22222222-2222-4222-8222-222222222222',
      },
      async (ctx) => `${ctx.tenantId}:${ctx.role}`,
      stubProvider,
    );
    expect(result).toBe('22222222-2222-4222-8222-222222222222:CLEANER');
  });

  it('resolves a tenant slug server-side for a member', async () => {
    const slugProvider = {
      listMemberships: async () => MEMBERSHIPS,
      resolveTenantIdBySlug: async (slug: string) =>
        slug === 'palm-cleaners' ? '11111111-1111-4111-8111-111111111111' : null,
    };
    const ctx = await resolveTenant(
      { userId: USER_ID, requestedTenantId: 'palm-cleaners' },
      slugProvider,
    );
    expect(ctx).toEqual({
      tenantId: '11111111-1111-4111-8111-111111111111',
      userId: USER_ID,
      role: 'OWNER',
    });
  });

  it('rejects an unknown slug', async () => {
    const slugProvider = {
      listMemberships: async () => MEMBERSHIPS,
      resolveTenantIdBySlug: async () => null,
    };
    await expect(
      resolveTenant(
        { userId: USER_ID, requestedTenantId: 'no-such-business' },
        slugProvider,
      ),
    ).rejects.toBeInstanceOf(TenantAccessDeniedError);
  });

  it('rejects a slug for a tenant the user does not belong to', async () => {
    const slugProvider = {
      listMemberships: async () => MEMBERSHIPS,
      resolveTenantIdBySlug: async (slug: string) =>
        slug === 'rival-cleaners' ? '33333333-3333-4333-8333-333333333333' : null,
    };
    await expect(
      resolveTenant(
        { userId: USER_ID, requestedTenantId: 'rival-cleaners' },
        slugProvider,
      ),
    ).rejects.toBeInstanceOf(TenantAccessDeniedError);
  });
});
