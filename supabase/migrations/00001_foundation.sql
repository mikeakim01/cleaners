-- ============================================================================
-- Phase 1 Track B — Foundation migration
-- Multi-tenant core: tenants, memberships, settings, branches, billing,
-- usage counters, audit logs, profiles + Row Level Security.
--
-- Conventions
--   * Money: `price_monthly_minor` stores INTEGER minor units (cents), i.e.
--     value = major_units * 100. TZS has no fractional cents in practice, so
--     TZS 95,000 is stored as 9500000. All billing math MUST stay in integers.
--   * Every tenant-scoped row carries `tenant_id`; RLS enforces isolation via
--     the `app.current_tenant` GUC combined with `public.is_tenant_member()`.
--     Client-supplied tenant ids are NEVER trusted — server code resolves the
--     tenant from `tenant_members` via the service role (see
--     src/server/tenant-context.ts).
--   * `tenant_members` uses ENABLE RLS but deliberately NOT FORCE RLS:
--     `is_tenant_member()` is SECURITY DEFINER and reads that table; FORCE
--     would make the policy recurse into itself (fail-closed outage).
--   * `plans` / `profiles` are global tables: ENABLE RLS without FORCE plus
--     read-scoped policies.
--   * This migration is idempotent-safe (IF NOT EXISTS / ON CONFLICT) and
--     contains its own policies — without them the migration is incomplete.
-- ============================================================================

-- Extensions ----------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pgjwt";

-- Helper: tenant membership check ------------------------------------------------
-- SECURITY DEFINER so it can read tenant_members past that table's RLS
-- (owner bypass; that table intentionally has no FORCE RLS, see above).
CREATE OR REPLACE FUNCTION public.is_tenant_member(check_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_members AS m
    WHERE m.tenant_id = check_tenant
      AND m.user_id = auth.uid()
      AND m.deleted_at IS NULL
  );
$$;

COMMENT ON FUNCTION public.is_tenant_member(uuid) IS
  'True when the calling auth user holds a non-deleted membership in check_tenant.';

-- Helper: keep updated_at fresh --------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Tenants -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenants (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text        NOT NULL UNIQUE,
  name          text        NOT NULL,
  phone_e164    text,
  timezone      text        NOT NULL DEFAULT 'Africa/Dar_es_Salaam',
  currency      text        NOT NULL DEFAULT 'TZS',
  logo_url      text,
  primary_color text        NOT NULL DEFAULT '#0F766E',
  secondary_color text,
  suspended     boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT tenants_slug_format_check
    CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

-- Memberships --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_members (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  user_id           uuid        NOT NULL,
  role              text        NOT NULL,
  extra_permissions jsonb       NOT NULL DEFAULT '{}'::jsonb,
  invited_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT tenant_members_role_check CHECK (role IN (
    'OWNER', 'ADMIN', 'MANAGER', 'SUPERVISOR',
    'CLEANER', 'DRIVER', 'ACCOUNTANT', 'CUSTOMER_SUPPORT'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_members_tenant_user_unique
  ON public.tenant_members (tenant_id, user_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tenant_members_user_idx
  ON public.tenant_members (user_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tenant_members_tenant_idx
  ON public.tenant_members (tenant_id)
  WHERE deleted_at IS NULL;

-- Business settings (one row per tenant) ------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_settings (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid         NOT NULL UNIQUE REFERENCES public.tenants (id) ON DELETE CASCADE,
  business_name   text,
  tin             text,
  vrn             text,
  address         text,
  invoice_prefix  text         NOT NULL DEFAULT 'INV-',
  quote_prefix    text         NOT NULL DEFAULT 'QUO-',
  booking_prefix  text         NOT NULL DEFAULT 'BK-',
  vat_rate        numeric(5, 2) NOT NULL DEFAULT 18.00,
  currency        text         NOT NULL DEFAULT 'TZS',
  timezone        text         NOT NULL DEFAULT 'Africa/Dar_es_Salaam',
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

-- Branches ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.branches (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  name       text        NOT NULL,
  ward       text,
  address    text,
  phone_e164 text,
  is_hq      boolean     NOT NULL DEFAULT false,
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS branches_tenant_name_unique
  ON public.branches (tenant_id, name)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS branches_tenant_idx
  ON public.branches (tenant_id)
  WHERE deleted_at IS NULL;

-- Plans (global catalogue, no tenant_id) -------------------------------------------
CREATE TABLE IF NOT EXISTS public.plans (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text         NOT NULL UNIQUE,
  price_monthly_minor integer      NOT NULL CONSTRAINT plans_price_non_negative CHECK (price_monthly_minor >= 0),
  currency            text         NOT NULL DEFAULT 'TZS',
  trial_days          integer      NOT NULL DEFAULT 14 CONSTRAINT plans_trial_non_negative CHECK (trial_days >= 0),
  limits              jsonb        NOT NULL DEFAULT '{}'::jsonb,
  features            jsonb        NOT NULL DEFAULT '[]'::jsonb,
  active              boolean      NOT NULL DEFAULT true,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

-- Subscriptions --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  plan_id            uuid        NOT NULL REFERENCES public.plans (id) ON DELETE RESTRICT,
  status             text        NOT NULL DEFAULT 'trialing',
  trial_ends_at      timestamptz,
  current_period_end timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  CONSTRAINT subscriptions_status_check CHECK (status IN (
    'trialing', 'active', 'past_due', 'canceled', 'paused'
  ))
);

CREATE INDEX IF NOT EXISTS subscriptions_tenant_idx
  ON public.subscriptions (tenant_id)
  WHERE deleted_at IS NULL;

-- Usage counters --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.usage_counters (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  metric     text        NOT NULL,
  period     text        NOT NULL,
  count      integer     NOT NULL DEFAULT 0 CONSTRAINT usage_counters_count_non_negative CHECK (count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT usage_counters_tenant_metric_period_unique
    UNIQUE (tenant_id, metric, period)
);

-- Audit logs (immutable: created_at only, no updates/deletes by design) --------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  user_id    uuid,
  action     text        NOT NULL,
  entity     text        NOT NULL,
  entity_id  uuid,
  ip         text,
  metadata   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_tenant_idx
  ON public.audit_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx
  ON public.audit_logs (entity, entity_id);

-- Profiles (global, keyed by auth user) ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  user_id    uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  full_name  text,
  avatar_url text,
  phone_e164 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- updated_at triggers -----------------------------------------------------------------
DROP TRIGGER IF EXISTS set_updated_at ON public.tenants;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.tenant_members;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.business_settings;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.business_settings
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.branches;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.plans;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.subscriptions;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.usage_counters;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.usage_counters
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.profiles;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Row Level Security --------------------------------------------------------------------
-- Tenants (self-scoped via id)
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.tenants;
CREATE POLICY "tenant_isolation" ON public.tenants
  FOR ALL TO authenticated
  USING (
    id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(id)
  )
  WITH CHECK (
    id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(id)
  );

-- Memberships (ENABLE only — see header note on FORCE/recursion)
ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.tenant_members;
CREATE POLICY "tenant_isolation" ON public.tenant_members
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- Business settings
ALTER TABLE public.business_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.business_settings;
CREATE POLICY "tenant_isolation" ON public.business_settings
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- Branches
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.branches;
CREATE POLICY "tenant_isolation" ON public.branches
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- Subscriptions
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.subscriptions;
CREATE POLICY "tenant_isolation" ON public.subscriptions
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- Usage counters
ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_counters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.usage_counters;
CREATE POLICY "tenant_isolation" ON public.usage_counters
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- Audit logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.audit_logs;
CREATE POLICY "tenant_isolation" ON public.audit_logs
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- Plans: globally readable catalogue (active rows visible incl. anonymous pricing page)
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plans_readable" ON public.plans;
CREATE POLICY "plans_readable" ON public.plans
  FOR SELECT TO anon, authenticated
  USING (active IS TRUE AND deleted_at IS NULL);

-- Profiles: owners manage their own row
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_owner_read" ON public.profiles;
CREATE POLICY "profiles_owner_read" ON public.profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS "profiles_owner_write" ON public.profiles;
CREATE POLICY "profiles_owner_write" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "profiles_owner_update" ON public.profiles;
CREATE POLICY "profiles_owner_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Grants (fail closed: only what each role needs) -----------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON public.tenants TO authenticated;
GRANT ALL ON public.tenant_members TO authenticated;
GRANT ALL ON public.business_settings TO authenticated;
GRANT ALL ON public.branches TO authenticated;
GRANT ALL ON public.subscriptions TO authenticated;
GRANT ALL ON public.usage_counters TO authenticated;
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT SELECT ON public.plans TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;

-- Plan catalogue seed ----------------------------------------------------------------------
-- price_monthly_minor is INTEGER minor units (cents): TZS 95,000 -> 9500000.
INSERT INTO public.plans (name, price_monthly_minor, currency, trial_days, limits, features, active)
VALUES
  ('Starter', 9500000, 'TZS', 14,
    '{"branches": 1, "staff": 5, "bookings_per_month": 200}'::jsonb,
    '["Bookings calendar", "Customer directory", "M-Pesa records", "Basic reports"]'::jsonb,
    true),
  ('Growth', 15000000, 'TZS', 14,
    '{"branches": 3, "staff": 20, "bookings_per_month": 1500}'::jsonb,
    '["Everything in Starter", "Multi-branch", "Driver dispatch", "WhatsApp reminders", "Advanced reports"]'::jsonb,
    true),
  ('Enterprise', 30000000, 'TZS', 30,
    '{"branches": -1, "staff": -1, "bookings_per_month": -1}'::jsonb,
    '["Everything in Growth", "Unlimited usage", "Dedicated support", "Custom integrations", "SLA"]'::jsonb,
    true)
ON CONFLICT (name) DO NOTHING;
