-- ============================================================================
-- Phase 5 Track M — Portal migration
-- reviews, customer_access_codes + RLS.
--
-- NOTE: portal/public reads go through service-role server actions
-- (anon has no SELECT); these policies guard authenticated dashboard access.
--
-- Conventions
--   * Every tenant-scoped row carries `tenant_id`; RLS enforces isolation via
--     the `app.current_tenant` GUC combined with `public.is_tenant_member()`.
--     Client-supplied tenant ids are NEVER trusted.
--   * All tenant tables use ENABLE RLS + FORCE RLS + policy "tenant_isolation"
--     FOR ALL TO authenticated (same shape as foundation / core CRM /
--     financial / whatsapp).
--   * Soft-delete via `deleted_at`; unique references are partial
--     (WHERE deleted_at IS NULL) so re-use after delete stays possible.
--   * This migration is idempotent-safe (IF NOT EXISTS / DROP POLICY IF EXISTS)
--     and contains its own policies — without them the migration is incomplete.
-- ============================================================================

-- Reviews --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reviews (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  booking_id    uuid        NOT NULL REFERENCES public.bookings (id) ON DELETE CASCADE,
  customer_id   uuid        NOT NULL REFERENCES public.customers (id) ON DELETE CASCADE,
  job_id        uuid        REFERENCES public.jobs (id) ON DELETE SET NULL,
  rating        smallint    NOT NULL CONSTRAINT reviews_rating_check CHECK (rating BETWEEN 1 AND 5),
  comment       text        NOT NULL DEFAULT '',
  source        text        NOT NULL DEFAULT 'portal' CONSTRAINT reviews_source_check CHECK (source IN (
    'portal', 'public', 'whatsapp', 'staff'
  )),
  response      text,
  responded_by  uuid,
  responded_at  timestamptz,
  published     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

-- One review per booking (deleted rows excluded so re-review after delete stays possible).
CREATE UNIQUE INDEX IF NOT EXISTS reviews_tenant_booking_unique
  ON public.reviews (tenant_id, booking_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS reviews_tenant_rating_idx
  ON public.reviews (tenant_id, rating);
CREATE INDEX IF NOT EXISTS reviews_tenant_customer_idx
  ON public.reviews (tenant_id, customer_id);

-- Customer access codes -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_access_codes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  customer_id uuid        NOT NULL REFERENCES public.customers (id) ON DELETE CASCADE,
  code_hash   text        NOT NULL,
  purpose     text        NOT NULL DEFAULT 'portal_login' CONSTRAINT customer_access_codes_purpose_check CHECK (purpose IN (
    'portal_login'
  )),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  attempts    integer     NOT NULL DEFAULT 0 CONSTRAINT customer_access_codes_attempts_non_negative CHECK (attempts >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE INDEX IF NOT EXISTS customer_access_codes_tenant_customer_expires_idx
  ON public.customer_access_codes (tenant_id, customer_id, expires_at);

-- updated_at triggers ----------------------------------------------------------
DROP TRIGGER IF EXISTS set_updated_at ON public.reviews;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.customer_access_codes;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.customer_access_codes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Row Level Security ------------------------------------------------------------
-- Reviews
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.reviews;
CREATE POLICY "tenant_isolation" ON public.reviews
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- Customer access codes
ALTER TABLE public.customer_access_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_access_codes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.customer_access_codes;
CREATE POLICY "tenant_isolation" ON public.customer_access_codes
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- Grants (fail closed: only what each role needs) -------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON public.reviews TO authenticated;
GRANT ALL ON public.customer_access_codes TO authenticated;
