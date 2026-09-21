-- ============================================================================
-- Phase 6 Track P — Billing events, platform audit logs, feature flags
-- Tenant-scoped billing history (subscription_events) follows the same
-- tenant-isolation RLS convention as 00001_foundation.sql:
--   ENABLE + FORCE RLS + "tenant_isolation" policy via
--   app.current_tenant GUC + public.is_tenant_member().
-- Platform tables (platform_audit_logs, feature_flags) are NOT tenant-scoped:
-- gated by public.is_super_admin() which reads
-- auth.jwt()->'app_metadata'->>'is_super_admin' = 'true'.
-- Access notes:
--   * service_role bypasses RLS (owner bypass) — server code in
--     src/server/* uses it with explicit tenant scoping.
--   * anon has no access to any table in this migration.
-- Idempotent-safe (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- ============================================================================

-- Helper: platform super-admin check -------------------------------------------
-- SECURITY DEFINER, STABLE, locked search_path. Reads the JWT app_metadata
-- claim; never trust client-supplied headers for this.
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'is_super_admin') = 'true',
    false
  );
$$;

COMMENT ON FUNCTION public.is_super_admin() IS
  'True when the calling auth user carries app_metadata.is_super_admin = true.';

-- Subscription events (tenant-scoped, immutable like audit_logs) ----------------
CREATE TABLE IF NOT EXISTS public.subscription_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  subscription_id uuid        REFERENCES public.subscriptions (id) ON DELETE SET NULL,
  type            text        NOT NULL,
  amount_minor    integer     NOT NULL DEFAULT 0,
  currency        text        NOT NULL DEFAULT 'TZS',
  provider        text,
  provider_ref    text,
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  user_id         uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT subscription_events_type_check CHECK (type IN (
    'trial_started', 'trial_ending', 'trial_expired', 'plan_changed',
    'subscription_activated', 'payment_recorded', 'payment_failed',
    'subscription_canceled', 'subscription_paused', 'subscription_resumed'
  )),
  CONSTRAINT subscription_events_provider_check CHECK (
    provider IS NULL OR provider IN ('manual_mpesa', 'manual_bank', 'stripe')
  ),
  CONSTRAINT subscription_events_amount_non_negative CHECK (amount_minor >= 0)
);

CREATE INDEX IF NOT EXISTS subscription_events_tenant_created_idx
  ON public.subscription_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS subscription_events_subscription_idx
  ON public.subscription_events (subscription_id)
  WHERE subscription_id IS NOT NULL;

-- Platform audit logs (platform-level, no tenant requirement) --------------------
CREATE TABLE IF NOT EXISTS public.platform_audit_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  action        text        NOT NULL,
  tenant_id     uuid        REFERENCES public.tenants (id) ON DELETE SET NULL,
  metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ip            text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_audit_logs_created_idx
  ON public.platform_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS platform_audit_logs_tenant_idx
  ON public.platform_audit_logs (tenant_id)
  WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS platform_audit_logs_actor_idx
  ON public.platform_audit_logs (actor_user_id)
  WHERE actor_user_id IS NOT NULL;

-- Feature flags (platform-level catalogue) ---------------------------------------
CREATE TABLE IF NOT EXISTS public.feature_flags (
  key         text        PRIMARY KEY,
  enabled     boolean     NOT NULL DEFAULT false,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_updated_at ON public.feature_flags;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Row Level Security ---------------------------------------------------------------
-- subscription_events: identical tenant_isolation convention (ENABLE + FORCE).
ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.subscription_events;
CREATE POLICY "tenant_isolation" ON public.subscription_events
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- platform_audit_logs: platform admins only (ENABLE RLS, no FORCE — no recursion
-- risk since is_super_admin() reads the JWT, not the table).
ALTER TABLE public.platform_audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "platform_admin_only" ON public.platform_audit_logs;
CREATE POLICY "platform_admin_only" ON public.platform_audit_logs
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- feature_flags: admin-only for all operations (reads included; clients must go
-- through server code with the service role).
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "platform_admin_only" ON public.feature_flags;
CREATE POLICY "platform_admin_only" ON public.feature_flags
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- Grants (fail closed) ---------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT ON public.subscription_events TO authenticated;
GRANT SELECT, INSERT ON public.platform_audit_logs TO authenticated;
-- No grants on feature_flags to anon/authenticated beyond USAGE: admin-only via
-- service role. Explicitly revoke to stay fail-closed on re-runs.
REVOKE ALL ON public.feature_flags FROM anon, authenticated;
