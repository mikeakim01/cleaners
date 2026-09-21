-- ============================================================================
-- Phase 2 Track D — Core CRM migration
-- customers, services, bookings, quotes, quote_items, employees, teams,
-- team_members, jobs, job_assignments, availability_slots + RLS.
--
-- Conventions
--   * Money: all `*_minor` columns store INTEGER minor units (cents), i.e.
--     value = major_units * 100. TZS has no fractional cents in practice, so
--     TZS 95,000 is stored as 9500000. All pricing math MUST stay in integers.
--   * Every tenant-scoped row carries `tenant_id`; RLS enforces isolation via
--     the `app.current_tenant` GUC combined with `public.is_tenant_member()`.
--     Client-supplied tenant ids are NEVER trusted.
--   * All tenant tables use ENABLE RLS + FORCE RLS + policy "tenant_isolation"
--     FOR ALL TO authenticated (same shape as foundation).
--   * Soft-delete via `deleted_at`; unique references are partial
--     (WHERE deleted_at IS NULL) so re-use after delete stays possible.
--   * This migration is idempotent-safe (IF NOT EXISTS / DROP POLICY IF EXISTS)
--     and contains its own policies — without them the migration is incomplete.
-- ============================================================================

-- Customers -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customers (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  branch_id     uuid        REFERENCES public.branches (id),
  full_name     text        NOT NULL,
  vip           boolean     NOT NULL DEFAULT false,
  phone_e164    text        NOT NULL,
  email         text,
  address       text,
  ward          text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_phone_unique
  ON public.customers (tenant_id, phone_e164)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS customers_tenant_idx
  ON public.customers (tenant_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS customers_tenant_phone_idx
  ON public.customers (tenant_id, phone_e164);

-- Services --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.services (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  name              text        NOT NULL,
  description       text,
  pricing_model     text        NOT NULL,
  base_price_minor  integer     NOT NULL DEFAULT 0 CONSTRAINT services_base_non_negative CHECK (base_price_minor >= 0),
  unit_price_minor  integer     NOT NULL DEFAULT 0 CONSTRAINT services_unit_non_negative CHECK (unit_price_minor >= 0),
  active            boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT services_pricing_model_check CHECK (pricing_model IN (
    'FIXED', 'PER_HOUR', 'PER_ROOM', 'PER_SQM', 'PER_ITEM', 'PER_UNIT', 'CUSTOM_QUOTE'
  ))
);

CREATE INDEX IF NOT EXISTS services_tenant_idx
  ON public.services (tenant_id)
  WHERE deleted_at IS NULL;

-- Bookings --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bookings (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  branch_id         uuid        REFERENCES public.branches (id),
  customer_id       uuid        REFERENCES public.customers (id),
  service_id        uuid        REFERENCES public.services (id),
  reference         text        NOT NULL,
  status            text        NOT NULL DEFAULT 'NEW',
  amount_minor      integer     NOT NULL DEFAULT 0 CONSTRAINT bookings_amount_non_negative CHECK (amount_minor >= 0),
  currency          text        NOT NULL DEFAULT 'TZS',
  scheduled_at      timestamptz,
  address           text,
  ward              text,
  property_snapshot jsonb       NOT NULL DEFAULT '{}'::jsonb,
  notes             text,
  source            text        NOT NULL DEFAULT 'dashboard',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT bookings_status_check CHECK (status IN (
    'NEW', 'PENDING_REVIEW', 'QUOTE_REQUIRED', 'QUOTE_SENT', 'AWAITING_CUSTOMER',
    'CONFIRMED', 'SCHEDULED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS',
    'COMPLETED', 'PAYMENT_PENDING', 'PAID', 'CANCELLED', 'REJECTED'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS bookings_tenant_reference_unique
  ON public.bookings (tenant_id, reference)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS bookings_tenant_status_scheduled_idx
  ON public.bookings (tenant_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS bookings_tenant_reference_idx
  ON public.bookings (tenant_id, reference);
CREATE INDEX IF NOT EXISTS bookings_tenant_customer_idx
  ON public.bookings (tenant_id, customer_id);

-- Quotes ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quotes (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  booking_id     uuid        REFERENCES public.bookings (id) ON DELETE CASCADE,
  customer_id    uuid        REFERENCES public.customers (id),
  reference      text        NOT NULL,
  status         text        NOT NULL DEFAULT 'DRAFT',
  subtotal_minor integer     NOT NULL DEFAULT 0 CONSTRAINT quotes_subtotal_non_negative CHECK (subtotal_minor >= 0),
  discount_minor integer     NOT NULL DEFAULT 0 CONSTRAINT quotes_discount_non_negative CHECK (discount_minor >= 0),
  vat_minor      integer     NOT NULL DEFAULT 0 CONSTRAINT quotes_vat_non_negative CHECK (vat_minor >= 0),
  total_minor    integer     NOT NULL DEFAULT 0 CONSTRAINT quotes_total_non_negative CHECK (total_minor >= 0),
  valid_until    date,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  CONSTRAINT quotes_status_check CHECK (status IN (
    'DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'EXPIRED'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS quotes_tenant_reference_unique
  ON public.quotes (tenant_id, reference)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS quotes_tenant_idx
  ON public.quotes (tenant_id)
  WHERE deleted_at IS NULL;

-- Quote items -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quote_items (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  quote_id         uuid        NOT NULL REFERENCES public.quotes (id) ON DELETE CASCADE,
  description      text        NOT NULL,
  qty              numeric     NOT NULL DEFAULT 1,
  unit_price_minor integer     NOT NULL DEFAULT 0 CONSTRAINT quote_items_unit_non_negative CHECK (unit_price_minor >= 0),
  total_minor      integer     NOT NULL DEFAULT 0 CONSTRAINT quote_items_total_non_negative CHECK (total_minor >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

CREATE INDEX IF NOT EXISTS quote_items_quote_idx
  ON public.quote_items (quote_id)
  WHERE deleted_at IS NULL;

-- Employees -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employees (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  branch_id   uuid        REFERENCES public.branches (id),
  user_id     uuid,
  full_name   text        NOT NULL,
  phone_e164  text,
  role        text        NOT NULL DEFAULT 'CLEANER',
  active      boolean     NOT NULL DEFAULT true,
  hire_date   date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CONSTRAINT employees_role_check CHECK (role IN (
    'CLEANER', 'DRIVER', 'SUPERVISOR', 'MANAGER'
  ))
);

CREATE INDEX IF NOT EXISTS employees_tenant_role_idx
  ON public.employees (tenant_id, role)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS employees_tenant_branch_idx
  ON public.employees (tenant_id, branch_id)
  WHERE deleted_at IS NULL;

-- Teams -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teams (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  branch_id        uuid        REFERENCES public.branches (id),
  name             text        NOT NULL,
  lead_employee_id uuid        REFERENCES public.employees (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

CREATE INDEX IF NOT EXISTS teams_tenant_idx
  ON public.teams (tenant_id)
  WHERE deleted_at IS NULL;

-- Team members ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_members (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  team_id     uuid        NOT NULL REFERENCES public.teams (id) ON DELETE CASCADE,
  employee_id uuid        NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS team_members_team_employee_unique
  ON public.team_members (team_id, employee_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS team_members_team_idx
  ON public.team_members (team_id)
  WHERE deleted_at IS NULL;

-- Jobs ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.jobs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  booking_id   uuid        NOT NULL UNIQUE REFERENCES public.bookings (id) ON DELETE CASCADE,
  team_id      uuid        REFERENCES public.teams (id),
  status       text        NOT NULL DEFAULT 'SCHEDULED',
  scheduled_at timestamptz,
  started_at   timestamptz,
  completed_at timestamptz,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  CONSTRAINT jobs_status_check CHECK (status IN (
    'SCHEDULED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
  ))
);

CREATE INDEX IF NOT EXISTS jobs_tenant_status_idx
  ON public.jobs (tenant_id, status)
  WHERE deleted_at IS NULL;

-- Job assignments -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_assignments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  job_id      uuid        NOT NULL REFERENCES public.jobs (id) ON DELETE CASCADE,
  employee_id uuid        NOT NULL REFERENCES public.employees (id),
  role        text        NOT NULL DEFAULT 'CLEANER',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS job_assignments_job_employee_unique
  ON public.job_assignments (job_id, employee_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS job_assignments_job_idx
  ON public.job_assignments (job_id)
  WHERE deleted_at IS NULL;

-- Availability slots ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.availability_slots (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  employee_id uuid        NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  weekday     integer     CONSTRAINT availability_slots_weekday_range CHECK (weekday >= 0 AND weekday <= 6),
  start_time  time,
  end_time    time,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE INDEX IF NOT EXISTS availability_slots_employee_idx
  ON public.availability_slots (employee_id)
  WHERE deleted_at IS NULL;

-- updated_at triggers ----------------------------------------------------------
DROP TRIGGER IF EXISTS set_updated_at ON public.customers;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.services;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.bookings;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.quotes;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.quote_items;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.quote_items
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.employees;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.teams;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.team_members;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.jobs;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.job_assignments;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.job_assignments
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.availability_slots;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.availability_slots
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Row Level Security ------------------------------------------------------------
-- Customers
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.customers;
CREATE POLICY "tenant_isolation" ON public.customers
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- Services
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.services;
CREATE POLICY "tenant_isolation" ON public.services
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- Bookings
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.bookings;
CREATE POLICY "tenant_isolation" ON public.bookings
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- Quotes
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.quotes;
CREATE POLICY "tenant_isolation" ON public.quotes
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- Quote items
ALTER TABLE public.quote_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.quote_items;
CREATE POLICY "tenant_isolation" ON public.quote_items
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- Employees
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.employees;
CREATE POLICY "tenant_isolation" ON public.employees
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- Teams
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.teams;
CREATE POLICY "tenant_isolation" ON public.teams
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- Team members
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.team_members;
CREATE POLICY "tenant_isolation" ON public.team_members
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- Jobs
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.jobs;
CREATE POLICY "tenant_isolation" ON public.jobs
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- Job assignments
ALTER TABLE public.job_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.job_assignments;
CREATE POLICY "tenant_isolation" ON public.job_assignments
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- Availability slots
ALTER TABLE public.availability_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_slots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.availability_slots;
CREATE POLICY "tenant_isolation" ON public.availability_slots
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
GRANT ALL ON public.customers TO authenticated;
GRANT ALL ON public.services TO authenticated;
GRANT ALL ON public.bookings TO authenticated;
GRANT ALL ON public.quotes TO authenticated;
GRANT ALL ON public.quote_items TO authenticated;
GRANT ALL ON public.employees TO authenticated;
GRANT ALL ON public.teams TO authenticated;
GRANT ALL ON public.team_members TO authenticated;
GRANT ALL ON public.jobs TO authenticated;
GRANT ALL ON public.job_assignments TO authenticated;
GRANT ALL ON public.availability_slots TO authenticated;
