-- ============================================================================
-- Phase 3 Track G — Financial migration
-- invoices, invoice_items, payments + RLS.
--
-- Conventions
--   * Money: all `*_minor` columns store INTEGER minor units (cents), i.e.
--     value = major_units * 100. TZS has no fractional cents in practice, so
--     TZS 95,000 is stored as 9500000. All pricing math MUST stay in integers.
--   * Every tenant-scoped row carries `tenant_id`; RLS enforces isolation via
--     the `app.current_tenant` GUC combined with `public.is_tenant_member()`.
--     Client-supplied tenant ids are NEVER trusted.
--   * All tenant tables use ENABLE RLS + FORCE RLS + policy "tenant_isolation"
--     FOR ALL TO authenticated (same shape as foundation / core CRM).
--   * Soft-delete via `deleted_at`; unique references are partial
--     (WHERE deleted_at IS NULL) so re-use after delete stays possible.
--   * This migration is idempotent-safe (IF NOT EXISTS / DROP POLICY IF EXISTS)
--     and contains its own policies — without them the migration is incomplete.
-- ============================================================================

-- Invoices --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoices (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  booking_id        uuid        REFERENCES public.bookings (id),
  customer_id       uuid        REFERENCES public.customers (id),
  reference         text        NOT NULL,
  status            text        NOT NULL DEFAULT 'DRAFT',
  subtotal_minor    integer     NOT NULL DEFAULT 0 CONSTRAINT invoices_subtotal_non_negative CHECK (subtotal_minor >= 0),
  discount_minor    integer     NOT NULL DEFAULT 0 CONSTRAINT invoices_discount_non_negative CHECK (discount_minor >= 0),
  vat_minor         integer     NOT NULL DEFAULT 0 CONSTRAINT invoices_vat_non_negative CHECK (vat_minor >= 0),
  surcharge_minor   integer     NOT NULL DEFAULT 0 CONSTRAINT invoices_surcharge_non_negative CHECK (surcharge_minor >= 0),
  total_minor       integer     NOT NULL DEFAULT 0 CONSTRAINT invoices_total_non_negative CHECK (total_minor >= 0),
  amount_paid_minor integer     NOT NULL DEFAULT 0 CONSTRAINT invoices_paid_non_negative CHECK (amount_paid_minor >= 0),
  currency          text        NOT NULL DEFAULT 'TZS',
  issue_date        date        NOT NULL DEFAULT CURRENT_DATE,
  due_date          date,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT invoices_status_check CHECK (status IN (
    'DRAFT', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE', 'VOID'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS invoices_tenant_reference_unique
  ON public.invoices (tenant_id, reference)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS invoices_tenant_status_idx
  ON public.invoices (tenant_id, status);
CREATE INDEX IF NOT EXISTS invoices_tenant_reference_idx
  ON public.invoices (tenant_id, reference);
CREATE INDEX IF NOT EXISTS invoices_tenant_customer_idx
  ON public.invoices (tenant_id, customer_id);

-- Invoice items ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_items (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  invoice_id       uuid        NOT NULL REFERENCES public.invoices (id) ON DELETE CASCADE,
  description      text        NOT NULL,
  qty              numeric     NOT NULL DEFAULT 1,
  unit_price_minor integer     NOT NULL DEFAULT 0 CONSTRAINT invoice_items_unit_non_negative CHECK (unit_price_minor >= 0),
  total_minor      integer     NOT NULL DEFAULT 0 CONSTRAINT invoice_items_total_non_negative CHECK (total_minor >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

CREATE INDEX IF NOT EXISTS invoice_items_invoice_idx
  ON public.invoice_items (invoice_id)
  WHERE deleted_at IS NULL;

-- Payments --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payments (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  invoice_id    uuid        NOT NULL REFERENCES public.invoices (id) ON DELETE CASCADE,
  amount_minor  integer     NOT NULL CONSTRAINT payments_amount_positive CHECK (amount_minor > 0),
  provider      text        NOT NULL,
  provider_ref  text,
  status        text        NOT NULL DEFAULT 'CONFIRMED',
  received_at   timestamptz NOT NULL DEFAULT now(),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT payments_provider_check CHECK (provider IN (
    'cash', 'bank_transfer', 'mobile_money', 'payment_link', 'stripe'
  )),
  CONSTRAINT payments_status_check CHECK (status IN (
    'PENDING', 'CONFIRMED', 'FAILED'
  ))
);

CREATE INDEX IF NOT EXISTS payments_tenant_invoice_idx
  ON public.payments (tenant_id, invoice_id);

-- updated_at triggers ----------------------------------------------------------
DROP TRIGGER IF EXISTS set_updated_at ON public.invoices;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.invoice_items;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.payments;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Row Level Security ------------------------------------------------------------
-- Invoices
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.invoices;
CREATE POLICY "tenant_isolation" ON public.invoices
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- Invoice items
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.invoice_items;
CREATE POLICY "tenant_isolation" ON public.invoice_items
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- Payments
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.payments;
CREATE POLICY "tenant_isolation" ON public.payments
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
GRANT ALL ON public.invoices TO authenticated;
GRANT ALL ON public.invoice_items TO authenticated;
GRANT ALL ON public.payments TO authenticated;
