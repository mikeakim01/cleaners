-- ============================================================================
-- Palm Cleaners demo seed (all phases)
-- Idempotent: safe to re-run (ON CONFLICT DO NOTHING + NOT EXISTS guards;
-- payments use a NOT EXISTS guard since they carry no unique constraint).
-- Contents: tenant + settings + 3 branches, 10 services (all pricing
-- models), 8 employees, 3 teams (+links), 10 customers, 15 bookings
-- (BK-8962..BK-8976, 15 of 16 lifecycle states), 15 jobs + 18 assignments,
-- 5 invoices, 5 payments, WhatsApp account + templates + rules +
-- 5 conversations + 12 messages, 10 reviews.
--
-- Run as a role that bypasses RLS (postgres / service_role), or inside a
-- transaction with row_security off, because tenant tables use FORCE RLS:
--   BEGIN; SET LOCAL row_security TO off; \i palm-cleaners.seed.sql
--   COMMIT;
-- All timestamps are relative to now() so the demo never goes stale.
-- ============================================================================

BEGIN;
SET LOCAL row_security TO off;

-- Demo tenant -------------------------------------------------------------------
INSERT INTO public.tenants (slug, name, phone_e164, timezone, currency, primary_color, created_at, updated_at)
VALUES (
  'palm-cleaners',
  'Palm Cleaners',
  '+255222600100',
  'Africa/Dar_es_Salaam',
  'TZS',
  '#0F766E',
  now() - interval '60 days',
  now()
)
ON CONFLICT DO NOTHING;

-- Business settings ---------------------------------------------------------------
INSERT INTO public.business_settings (
  tenant_id, business_name, tin, vrn, address,
  invoice_prefix, quote_prefix, booking_prefix,
  vat_rate, currency, timezone, created_at, updated_at
)
SELECT
  t.id,
  'Palm Cleaners Ltd',
  '123-456-789',
  '40012345A',
  'Plot 12, Haile Selassie Rd, Masaki, Dar es Salaam',
  'INV-', 'QUO-', 'BK-',
  18.00, 'TZS', 'Africa/Dar_es_Salaam',
  now() - interval '60 days',
  now()
FROM public.tenants AS t
WHERE t.slug = 'palm-cleaners'
ON CONFLICT DO NOTHING;

-- Branches -------------------------------------------------------------------------
INSERT INTO public.branches (
  tenant_id, name, ward, address, phone_e164, is_hq, active, created_at, updated_at
)
SELECT
  t.id, v.name, v.ward, v.address, v.phone_e164, v.is_hq, true,
  now() - interval '60 days',
  now()
FROM public.tenants AS t
CROSS JOIN (VALUES
  ('Masaki', 'Masaki', 'Plot 12, Haile Selassie Rd, Dar es Salaam', '+255222600100', true),
  ('Mikocheni', 'Mikocheni', 'Plot 45, Old Bagamoyo Rd, Dar es Salaam', '+255222600101', false),
  ('Kariakoo', 'Kariakoo', 'Plot 7, Uhuru St, Dar es Salaam', '+255222600102', false)
) AS v (name, ward, address, phone_e164, is_hq)
WHERE t.slug = 'palm-cleaners'
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Phase 2 Track D fixtures (append-only; idempotent via ON CONFLICT DO NOTHING)
-- Money: all *_minor are INTEGER cents (TZS 95,000 = 9500000).
-- Dates are relative to now() so the dashboard looks alive on every run.
-- ============================================================================

-- Services: 10 rows covering all 7 pricing models -------------------------------
INSERT INTO public.services (
  tenant_id, name, description, pricing_model,
  base_price_minor, unit_price_minor, active, created_at, updated_at
)
SELECT
  t.id, v.name, v.description, v.pricing_model,
  v.base_price_minor, v.unit_price_minor, true, now(), now()
FROM public.tenants AS t
CROSS JOIN (VALUES
  ('Deep House Cleaning', 'Full deep clean, whole house', 'FIXED', 9500000, 0),
  ('Hourly Touch-up', 'Hourly tidy-up and touch-up visits', 'PER_HOUR', 100000, 250000),
  ('Bedroom Cleaning', 'Per-bedroom standard clean', 'PER_ROOM', 0, 1500000),
  ('Floor Scrubbing', 'Machine floor scrub per square metre', 'PER_SQM', 0, 50000),
  ('Sofa Deep Clean', 'Per-sofa shampoo and extraction', 'PER_ITEM', 0, 200000),
  ('Window Pane Polish', 'Per window pane inside and out', 'PER_UNIT', 0, 30000),
  ('Custom Villa Quote', 'Scoped on-site quote for villas', 'CUSTOM_QUOTE', 4500000, 0),
  ('Office Block Cleaning', 'Scheduled office block contract', 'FIXED', 15000000, 0),
  ('Move-in Refresh', 'Move-in refresh per room', 'PER_ROOM', 0, 1200000),
  ('Post-Construction Cleanup', 'Dust and debris removal per sqm', 'PER_SQM', 500000, 80000)
) AS v (name, description, pricing_model, base_price_minor, unit_price_minor)
WHERE t.slug = 'palm-cleaners'
ON CONFLICT DO NOTHING;

-- Employees: 8 ------------------------------------------------------------------
INSERT INTO public.employees (
  tenant_id, branch_id, full_name, phone_e164, role, active, hire_date, created_at, updated_at
)
SELECT
  t.id,
  (SELECT b.id FROM public.branches AS b WHERE b.tenant_id = t.id AND b.name = v.branch_name AND b.deleted_at IS NULL),
  v.full_name, v.phone_e164, v.role, true,
  (now() - (v.days_ago || ' days')::interval)::date,
  now(), now()
FROM public.tenants AS t
CROSS JOIN (VALUES
  ('Juma Bakari', '+255754100101', 'SUPERVISOR', 'Masaki', 400),
  ('Neema Mollel', '+255754100102', 'CLEANER', 'Masaki', 320),
  ('Baraka Kimaro', '+255754100103', 'CLEANER', 'Mikocheni', 300),
  ('David Shirima', '+255754100104', 'DRIVER', 'Mikocheni', 280),
  ('Fatma Said', '+255754100105', 'CLEANER', 'Kariakoo', 200),
  ('Emmanuel Minja', '+255754100106', 'CLEANER', 'Kariakoo', 180),
  ('Hassani Mrope', '+255754100107', 'DRIVER', 'Masaki', 150),
  ('Salim Said', '+255754100108', 'MANAGER', 'Masaki', 500)
) AS v (full_name, phone_e164, role, branch_name, days_ago)
WHERE t.slug = 'palm-cleaners'
ON CONFLICT DO NOTHING;

-- Teams: 3 -----------------------------------------------------------------------
INSERT INTO public.teams (tenant_id, branch_id, name, lead_employee_id, created_at, updated_at)
SELECT
  t.id,
  (SELECT b.id FROM public.branches AS b WHERE b.tenant_id = t.id AND b.name = v.branch_name AND b.deleted_at IS NULL),
  v.name,
  (SELECT e.id FROM public.employees AS e WHERE e.tenant_id = t.id AND e.full_name = 'Juma Bakari' AND e.deleted_at IS NULL LIMIT 1),
  now(), now()
FROM public.tenants AS t
CROSS JOIN (VALUES
  ('Team Alpha', 'Masaki'),
  ('Team Beta', 'Mikocheni'),
  ('Team Gamma', 'Kariakoo')
) AS v (name, branch_name)
WHERE t.slug = 'palm-cleaners'
ON CONFLICT DO NOTHING;

-- Team members (best-effort links; duplicates ignored) -----------------------------
INSERT INTO public.team_members (tenant_id, team_id, employee_id, created_at, updated_at)
SELECT
  t.id,
  (SELECT te.id FROM public.teams AS te WHERE te.tenant_id = t.id AND te.name = v.team_name AND te.deleted_at IS NULL LIMIT 1),
  (SELECT e.id FROM public.employees AS e WHERE e.tenant_id = t.id AND e.full_name = v.employee_name AND e.deleted_at IS NULL LIMIT 1),
  now(), now()
FROM public.tenants AS t
CROSS JOIN (VALUES
  ('Team Alpha', 'Juma Bakari'),
  ('Team Alpha', 'Neema Mollel'),
  ('Team Beta', 'Baraka Kimaro'),
  ('Team Beta', 'David Shirima'),
  ('Team Gamma', 'Fatma Said'),
  ('Team Gamma', 'Emmanuel Minja'),
  ('Team Alpha', 'Hassani Mrope')
) AS v (team_name, employee_name)
WHERE t.slug = 'palm-cleaners'
  AND (SELECT te.id FROM public.teams AS te WHERE te.tenant_id = t.id AND te.name = v.team_name AND te.deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND (SELECT e.id FROM public.employees AS e WHERE e.tenant_id = t.id AND e.full_name = v.employee_name AND e.deleted_at IS NULL LIMIT 1) IS NOT NULL
ON CONFLICT DO NOTHING;

-- Customers: 10 --------------------------------------------------------------------
INSERT INTO public.customers (
  tenant_id, branch_id, full_name, vip, phone_e164, email,
  address, ward, notes, created_at, updated_at
)
SELECT
  t.id,
  (SELECT b.id FROM public.branches AS b WHERE b.tenant_id = t.id AND b.name = v.branch_name AND b.deleted_at IS NULL),
  v.full_name, v.vip, v.phone_e164, v.email, v.address, v.ward, NULL,
  now() - (v.days_ago || ' days')::interval, now()
FROM public.tenants AS t
CROSS JOIN (VALUES
  ('Asha Mwakalinga', true, '+255754882109', 'asha.mwakalinga@example.com', 'Plot 8, Haile Selassie Rd', 'Masaki', 'Masaki', 30),
  ('Juma Bakari', false, '+255756201344', 'juma.bakari@example.com', 'Plot 21, Bagamoyo Rd', 'Mikocheni', 'Mikocheni', 28),
  ('Neema Mollel', false, '+255713445902', 'neema.mollel@example.com', 'Plot 3, Uhuru St', 'Kariakoo', 'Kariakoo', 26),
  ('David Shirima', false, '+255767990213', 'david.shirima@example.com', 'Plot 14, Upanga Rd', 'Upanga', 'Masaki', 24),
  ('Zuwena Rashid', true, '+255744556781', 'zuwena.rashid@example.com', 'Plot 9, Ohio St', 'Ilala', 'Kariakoo', 22),
  ('Baraka Kimaro', false, '+255755112309', 'baraka.kimaro@example.com', 'Plot 30, Sam Nujoma Rd', 'Sinza', 'Mikocheni', 20),
  ('Fatma Said', false, '+255718903467', 'fatma.said@example.com', 'Plot 5, Msasani Rd', 'Msasani', 'Masaki', 18),
  ('Emanuel Minja', false, '+255769334520', 'emanuel.minja@example.com', 'Plot 11, Tabata Rd', 'Tabata', 'Kariakoo', 16),
  ('Hassani Mrope', false, '+255752667814', 'hassani.mrope@example.com', 'Plot 2, Kigamboni Rd', 'Kigamboni', 'Mikocheni', 14),
  ('Mary Kweka', true, '+255714298635', 'mary.kweka@example.com', 'Plot 17, Oysterbay Rd', 'Oysterbay', 'Masaki', 12)
) AS v (full_name, vip, phone_e164, email, address, ward, branch_name, days_ago)
WHERE t.slug = 'palm-cleaners'
ON CONFLICT DO NOTHING;

-- Bookings: 15 (BK-8962..BK-8976) covering 15 of 16 lifecycle states -----------
-- (only PENDING_REVIEW has no dedicated row; NEW covers the review queue).
-- Repeat customers model lifetime value (Asha, Emanuel, Hassani, Mary, Neema
-- and David book twice). Invoice links: INV-9001->8962, INV-9005->8965,
-- INV-9003->8972, INV-9002->8973, INV-9004->8974.
INSERT INTO public.bookings (
  tenant_id, branch_id, customer_id, service_id, reference, status,
  amount_minor, currency, scheduled_at, address, ward, property_snapshot,
  notes, source, created_at, updated_at
)
SELECT
  t.id,
  (SELECT b.id FROM public.branches AS b WHERE b.tenant_id = t.id AND b.name = v.branch_name AND b.deleted_at IS NULL),
  (SELECT c.id FROM public.customers AS c WHERE c.tenant_id = t.id AND c.phone_e164 = v.customer_phone AND c.deleted_at IS NULL LIMIT 1),
  (SELECT s.id FROM public.services AS s WHERE s.tenant_id = t.id AND s.name = v.service_name AND s.deleted_at IS NULL LIMIT 1),
  v.reference, v.status, v.amount_minor, 'TZS',
  now() + (v.day_offset || ' days')::interval,
  v.address, v.ward, '{}'::jsonb, NULL, 'dashboard',
  now() + (v.day_offset || ' days')::interval, now()
FROM public.tenants AS t
CROSS JOIN (VALUES
  ('BK-8962', 'NEW', 9500000, -2, 'Asha Mwakalinga', '+255754882109', 'Deep House Cleaning', 'Masaki', 'Plot 8, Haile Selassie Rd', 'Masaki'),
  ('BK-8963', 'QUOTE_REQUIRED', 850000, -1, 'Juma Bakari', '+255756201344', 'Hourly Touch-up', 'Mikocheni', 'Plot 21, Bagamoyo Rd', 'Mikocheni'),
  ('BK-8964', 'QUOTE_SENT', 6000000, 0, 'Neema Mollel', '+255713445902', 'Bedroom Cleaning', 'Kariakoo', 'Plot 3, Uhuru St', 'Kariakoo'),
  ('BK-8965', 'AWAITING_CUSTOMER', 6000000, 1, 'David Shirima', '+255767990213', 'Floor Scrubbing', 'Masaki', 'Plot 14, Upanga Rd', 'Upanga'),
  ('BK-8966', 'CONFIRMED', 1000000, 2, 'Zuwena Rashid', '+255744556781', 'Sofa Deep Clean', 'Kariakoo', 'Plot 9, Ohio St', 'Ilala'),
  ('BK-8967', 'SCHEDULED', 600000, 2, 'Baraka Kimaro', '+255755112309', 'Window Pane Polish', 'Mikocheni', 'Plot 30, Sam Nujoma Rd', 'Sinza'),
  ('BK-8968', 'ASSIGNED', 4500000, 3, 'Fatma Said', '+255718903467', 'Custom Villa Quote', 'Masaki', 'Plot 5, Msasani Rd', 'Msasani'),
  ('BK-8969', 'EN_ROUTE', 15000000, 3, 'Emanuel Minja', '+255769334520', 'Office Block Cleaning', 'Kariakoo', 'Plot 11, Tabata Rd', 'Tabata'),
  ('BK-8970', 'ARRIVED', 4800000, 4, 'Hassani Mrope', '+255752667814', 'Move-in Refresh', 'Mikocheni', 'Plot 2, Kigamboni Rd', 'Kigamboni'),
  ('BK-8971', 'IN_PROGRESS', 6400000, 4, 'Mary Kweka', '+255714298635', 'Post-Construction Cleanup', 'Masaki', 'Plot 17, Oysterbay Rd', 'Oysterbay'),
  ('BK-8972', 'COMPLETED', 4500000, 3, 'Fatma Said', '+255718903467', 'Custom Villa Quote', 'Masaki', 'Plot 5, Msasani Rd', 'Msasani'),
  ('BK-8973', 'PAYMENT_PENDING', 15000000, 4, 'Emanuel Minja', '+255769334520', 'Office Block Cleaning', 'Kariakoo', 'Plot 11, Tabata Rd', 'Tabata'),
  ('BK-8974', 'PAID', 4800000, 5, 'Hassani Mrope', '+255752667814', 'Move-in Refresh', 'Mikocheni', 'Plot 2, Kigamboni Rd', 'Kigamboni'),
  ('BK-8975', 'CANCELLED', 6400000, -2, 'Mary Kweka', '+255714298635', 'Post-Construction Cleanup', 'Masaki', 'Plot 17, Oysterbay Rd', 'Oysterbay'),
  ('BK-8976', 'REJECTED', 6000000, 0, 'Neema Mollel', '+255713445902', 'Bedroom Cleaning', 'Kariakoo', 'Plot 3, Uhuru St', 'Kariakoo')
) AS v (reference, status, amount_minor, day_offset, customer_name, customer_phone, service_name, branch_name, address, ward)
WHERE t.slug = 'palm-cleaners'
ON CONFLICT DO NOTHING;

-- Jobs: one per booking, status-matched --------------------------------------------
INSERT INTO public.jobs (
  tenant_id, booking_id, team_id, status,
  scheduled_at, started_at, completed_at, notes, created_at, updated_at
)
SELECT
  t.id,
  (SELECT bk.id FROM public.bookings AS bk WHERE bk.tenant_id = t.id AND bk.reference = v.reference AND bk.deleted_at IS NULL LIMIT 1),
  (SELECT te.id FROM public.teams AS te WHERE te.tenant_id = t.id AND te.name = v.team_name AND te.deleted_at IS NULL LIMIT 1),
  v.status,
  now() + (v.day_offset || ' days')::interval,
  CASE WHEN v.status IN ('EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED') THEN now() + ((v.day_offset || ' days')::interval) ELSE NULL END,
  CASE WHEN v.status = 'COMPLETED' THEN now() + ((v.day_offset || ' days')::interval) + interval '3 hours' ELSE NULL END,
  NULL,
  now(), now()
FROM public.tenants AS t
CROSS JOIN (VALUES
  ('BK-8962', 'SCHEDULED', 'Team Alpha', -2),
  ('BK-8963', 'SCHEDULED', 'Team Beta', -1),
  ('BK-8964', 'SCHEDULED', 'Team Gamma', 0),
  ('BK-8965', 'SCHEDULED', 'Team Alpha', 1),
  ('BK-8966', 'ASSIGNED', 'Team Beta', 2),
  ('BK-8967', 'ASSIGNED', 'Team Gamma', 2),
  ('BK-8968', 'ASSIGNED', 'Team Alpha', 3),
  ('BK-8969', 'EN_ROUTE', 'Team Beta', 3),
  ('BK-8970', 'ARRIVED', 'Team Gamma', 4),
  ('BK-8971', 'IN_PROGRESS', 'Team Alpha', 4),
  ('BK-8972', 'COMPLETED', 'Team Beta', 3),
  ('BK-8973', 'COMPLETED', 'Team Gamma', 4),
  ('BK-8974', 'COMPLETED', 'Team Alpha', 5),
  ('BK-8975', 'CANCELLED', 'Team Beta', -2),
  ('BK-8976', 'CANCELLED', 'Team Gamma', 0)
) AS v (reference, status, team_name, day_offset)
WHERE t.slug = 'palm-cleaners'
  AND (SELECT bk.id FROM public.bookings AS bk WHERE bk.tenant_id = t.id AND bk.reference = v.reference AND bk.deleted_at IS NULL LIMIT 1) IS NOT NULL
ON CONFLICT DO NOTHING;

-- Job assignments: two crew per field job (powers the cleaner app + dispatch) ----
INSERT INTO public.job_assignments (
  tenant_id, job_id, employee_id, role, created_at, updated_at
)
SELECT
  t.id,
  (SELECT j.id FROM public.jobs AS j
    JOIN public.bookings AS bk ON bk.id = j.booking_id
    WHERE j.tenant_id = t.id AND bk.reference = v.reference
      AND j.deleted_at IS NULL LIMIT 1),
  (SELECT e.id FROM public.employees AS e WHERE e.tenant_id = t.id AND e.full_name = v.employee_name AND e.deleted_at IS NULL LIMIT 1),
  'CLEANER',
  now(), now()
FROM public.tenants AS t
CROSS JOIN (VALUES
  ('BK-8966', 'Baraka Kimaro'),
  ('BK-8966', 'David Shirima'),
  ('BK-8967', 'Fatma Said'),
  ('BK-8967', 'Emmanuel Minja'),
  ('BK-8968', 'Juma Bakari'),
  ('BK-8968', 'Neema Mollel'),
  ('BK-8969', 'Baraka Kimaro'),
  ('BK-8969', 'David Shirima'),
  ('BK-8970', 'Fatma Said'),
  ('BK-8970', 'Emmanuel Minja'),
  ('BK-8971', 'Neema Mollel'),
  ('BK-8971', 'Hassani Mrope'),
  ('BK-8972', 'Fatma Said'),
  ('BK-8972', 'Emmanuel Minja'),
  ('BK-8973', 'Baraka Kimaro'),
  ('BK-8973', 'David Shirima'),
  ('BK-8974', 'Juma Bakari'),
  ('BK-8974', 'Hassani Mrope')
) AS v (reference, employee_name)
WHERE t.slug = 'palm-cleaners'
  AND (SELECT j.id FROM public.jobs AS j
    JOIN public.bookings AS bk ON bk.id = j.booking_id
    WHERE j.tenant_id = t.id AND bk.reference = v.reference
      AND j.deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND (SELECT e.id FROM public.employees AS e WHERE e.tenant_id = t.id AND e.full_name = v.employee_name AND e.deleted_at IS NULL LIMIT 1) IS NOT NULL
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Phase 3 Track G fixtures (append-only; idempotent via ON CONFLICT DO NOTHING)
-- Money: all *_minor are INTEGER cents (TZS 95,000 = 9500000).
-- VAT is 18%: total = subtotal - discount + vat + surcharge.
-- ============================================================================

-- Invoices: 5 (DRAFT, SENT, PARTIAL, PAID, OVERDUE) -----------------------------
INSERT INTO public.invoices (
  tenant_id, booking_id, customer_id, reference, status,
  subtotal_minor, discount_minor, vat_minor, surcharge_minor,
  total_minor, amount_paid_minor, currency,
  issue_date, due_date, notes, created_at, updated_at
)
SELECT
  t.id,
  (SELECT bk.id FROM public.bookings AS bk WHERE bk.tenant_id = t.id AND bk.reference = v.booking_ref AND bk.deleted_at IS NULL LIMIT 1),
  (SELECT bk.customer_id FROM public.bookings AS bk WHERE bk.tenant_id = t.id AND bk.reference = v.booking_ref AND bk.deleted_at IS NULL LIMIT 1),
  v.reference, v.status,
  v.subtotal_minor, v.discount_minor, v.vat_minor, v.surcharge_minor,
  v.total_minor, v.amount_paid_minor, 'TZS',
  (now() + (v.issue_offset || ' days')::interval)::date,
  (now() + (v.due_offset || ' days')::interval)::date,
  NULL,
  now(), now()
FROM public.tenants AS t
CROSS JOIN (VALUES
  ('INV-9001', 'DRAFT', 'BK-8962', 9500000, 0, 1710000, 0, 11210000, 0, -2, 14),
  ('INV-9002', 'SENT', 'BK-8973', 6000000, 500000, 990000, 0, 6490000, 0, -1, 14),
  ('INV-9003', 'PARTIAL', 'BK-8972', 15000000, 0, 2700000, 0, 17700000, 8850000, -5, 9),
  ('INV-9004', 'PAID', 'BK-8974', 4800000, 0, 864000, 0, 5664000, 5664000, -12, -5),
  ('INV-9005', 'OVERDUE', 'BK-8965', 4500000, 200000, 774000, 100000, 5174000, 0, -30, -10)
) AS v (reference, status, booking_ref, subtotal_minor, discount_minor, vat_minor, surcharge_minor, total_minor, amount_paid_minor, issue_offset, due_offset)
WHERE t.slug = 'palm-cleaners'
  AND (SELECT bk.id FROM public.bookings AS bk WHERE bk.tenant_id = t.id AND bk.reference = v.booking_ref AND bk.deleted_at IS NULL LIMIT 1) IS NOT NULL
ON CONFLICT DO NOTHING;

-- Invoice items: one line per invoice -------------------------------------------
INSERT INTO public.invoice_items (
  tenant_id, invoice_id, description, qty, unit_price_minor, total_minor,
  created_at, updated_at
)
SELECT
  t.id,
  (SELECT i.id FROM public.invoices AS i WHERE i.tenant_id = t.id AND i.reference = v.invoice_ref AND i.deleted_at IS NULL LIMIT 1),
  v.description, 1, v.total_minor, v.total_minor,
  now(), now()
FROM public.tenants AS t
CROSS JOIN (VALUES
  ('INV-9001', 'Deep House Cleaning — whole house', 11210000),
  ('INV-9002', 'Office Block Cleaning — scheduled contract', 6490000),
  ('INV-9003', 'Custom Villa Quote — scoped on-site work', 17700000),
  ('INV-9004', 'Move-in Refresh — per room', 5664000),
  ('INV-9005', 'Floor Scrubbing — machine scrub', 5174000)
) AS v (invoice_ref, description, total_minor)
WHERE t.slug = 'palm-cleaners'
  AND (SELECT i.id FROM public.invoices AS i WHERE i.tenant_id = t.id AND i.reference = v.invoice_ref AND i.deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.invoice_items AS ii
    WHERE ii.tenant_id = t.id
      AND ii.invoice_id = (SELECT i.id FROM public.invoices AS i WHERE i.tenant_id = t.id AND i.reference = v.invoice_ref AND i.deleted_at IS NULL LIMIT 1)
      AND ii.description = v.description
      AND ii.deleted_at IS NULL
  )
ON CONFLICT DO NOTHING;

-- Payments: 5 (cash full, bank part, mobile PENDING, mobile CONFIRMED, cash part)
-- INV-9003 PARTIAL reconciles: 2000000 + 5000000 + 1850000 = 8850000 (half).
-- INV-9004 PAID reconciles: 5664000 cash in full.
-- INV-9002 SENT keeps amount_paid 0: its mobile payment is still PENDING.
INSERT INTO public.payments (
  tenant_id, invoice_id, amount_minor, provider, provider_ref, status,
  received_at, notes, created_at, updated_at
)
SELECT
  t.id,
  (SELECT i.id FROM public.invoices AS i WHERE i.tenant_id = t.id AND i.reference = v.invoice_ref AND i.deleted_at IS NULL LIMIT 1),
  v.amount_minor, v.provider, v.provider_ref, v.status,
  now() + (v.day_offset || ' days')::interval,
  NULL,
  now(), now()
FROM public.tenants AS t
CROSS JOIN (VALUES
  ('INV-9004', 5664000, 'cash', NULL, 'CONFIRMED', -4),
  ('INV-9003', 2000000, 'bank_transfer', NULL, 'CONFIRMED', -3),
  ('INV-9002', 6490000, 'mobile_money', 'QA12B3C4D5', 'PENDING', 0),
  ('INV-9003', 5000000, 'mobile_money', 'QB98Z7Y6X5', 'CONFIRMED', -2),
  ('INV-9003', 1850000, 'cash', NULL, 'CONFIRMED', -1)
) AS v (invoice_ref, amount_minor, provider, provider_ref, status, day_offset)
WHERE t.slug = 'palm-cleaners'
  AND (SELECT i.id FROM public.invoices AS i WHERE i.tenant_id = t.id AND i.reference = v.invoice_ref AND i.deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.payments AS p
    WHERE p.tenant_id = t.id
      AND p.invoice_id = (SELECT i.id FROM public.invoices AS i WHERE i.tenant_id = t.id AND i.reference = v.invoice_ref AND i.deleted_at IS NULL LIMIT 1)
      AND p.amount_minor = v.amount_minor
      AND p.provider = v.provider
      AND COALESCE(p.provider_ref, '') = COALESCE(v.provider_ref, '')
      AND p.deleted_at IS NULL
  )
ON CONFLICT DO NOTHING;
-- ============================================================================
-- Phase 4 Track J fixtures (append-only; idempotent via ON CONFLICT DO NOTHING)
-- WhatsApp: account + templates + automation rules + conversations + messages.
-- NOTE: access_token_enc below is a clearly fake seed-only placeholder
-- ('v1.SEED.placeholder'), NOT a real encrypted token. Real tokens are
-- encrypted with APP_ENCRYPTION_KEY via encryptSecret (src/server/crypto.ts).
-- Timestamps are relative to now() so the inbox looks alive on every run.
-- ============================================================================

-- WhatsApp account: one per tenant (CONNECTED seed account) --------------------
INSERT INTO public.whatsapp_accounts (
  tenant_id, phone_number_id, display_name, waba_id, access_token_enc,
  status, last_tested_at, webhook_subscribed, created_at, updated_at
)
SELECT
  t.id, '109283749182374', 'Palm Cleaners', '293847192830192',
  'v1.SEED.placeholder', 'CONNECTED', now() - interval '1 day', true,
  now(), now()
FROM public.tenants AS t
WHERE t.slug = 'palm-cleaners'
ON CONFLICT DO NOTHING;

-- WhatsApp templates: 8 standard EN (APPROVED) + 3 SW (PENDING) ----------------
INSERT INTO public.whatsapp_templates (
  tenant_id, name, language, category, body, variables, status,
  created_at, updated_at
)
SELECT
  t.id, v.name, v.language, 'UTILITY', v.body, v.variables::jsonb, v.status,
  now(), now()
FROM public.tenants AS t
CROSS JOIN (VALUES
  ('booking_confirmed', 'en', 'Habari {{1}}! Your cleaning booking {{2}} is confirmed for {{3}}. Asante for choosing Palm Cleaners.', '["customer_name","booking_ref","scheduled_at"]', 'APPROVED'),
  ('quote_sent', 'en', 'Hello {{1}}, your quote {{2}} for {{3}} is ready. Reply YES to approve or call us for changes.', '["customer_name","quote_ref","total"]', 'APPROVED'),
  ('cleaner_enroute', 'en', 'Good news {{1}}! Your cleaning team is on the way and should arrive in about {{2}} minutes.', '["customer_name","eta_minutes"]', 'APPROVED'),
  ('cleaner_arrived', 'en', 'Hello {{1}}, your cleaning team has arrived at {{2}} and is starting work now.', '["customer_name","address"]', 'APPROVED'),
  ('job_completed', 'en', 'Asante {{1}}! Your cleaning for booking {{2}} is complete. Please rate us: {{3}}', '["customer_name","booking_ref","review_link"]', 'APPROVED'),
  ('invoice_due', 'en', 'Hello {{1}}, invoice {{2}} for {{3}} is due on {{4}}. Pay via M-Pesa or bank transfer. Asante!', '["customer_name","invoice_ref","total","due_date"]', 'APPROVED'),
  ('payment_received', 'en', 'Asante sana {{1}}! We received your payment of {{2}} for invoice {{3}}. Receipt to follow.', '["customer_name","amount","invoice_ref"]', 'APPROVED'),
  ('review_request', 'en', 'Habari {{1}}! How was your recent clean? Tap to leave a review: {{2}}', '["customer_name","review_link"]', 'APPROVED'),
  ('booking_confirmed', 'sw', 'Habari {{1}}! Booking yako ya usafi {{2}} imethibitishwa kwa {{3}}. Asante kwa kutuchagua Palm Cleaners.', '["customer_name","booking_ref","scheduled_at"]', 'PENDING'),
  ('cleaner_enroute', 'sw', 'Habari njema {{1}}! Timu yako ya usafi iko njiani na itafika baada ya dakika {{2}}.', '["customer_name","eta_minutes"]', 'PENDING'),
  ('payment_received', 'sw', 'Asante sana {{1}}! Tumepokea malipo yako ya {{2}} kwa ankara {{3}}.', '["customer_name","amount","invoice_ref"]', 'PENDING')
) AS v (name, language, body, variables, status)
WHERE t.slug = 'palm-cleaners'
ON CONFLICT DO NOTHING;

-- WhatsApp automation rules: one per event, linked to matching template --------
INSERT INTO public.whatsapp_automation_rules (
  tenant_id, event, template_id, active, created_at, updated_at
)
SELECT
  t.id,
  v.event,
  (SELECT wt.id FROM public.whatsapp_templates AS wt
    WHERE wt.tenant_id = t.id AND wt.name = v.template_name
      AND wt.language = 'en' AND wt.deleted_at IS NULL LIMIT 1),
  true, now(), now()
FROM public.tenants AS t
CROSS JOIN (VALUES
  ('booking.created', 'booking_confirmed'),
  ('booking.confirmed', 'booking_confirmed'),
  ('quote.sent', 'quote_sent'),
  ('job.en_route', 'cleaner_enroute'),
  ('job.arrived', 'cleaner_arrived'),
  ('job.completed', 'job_completed'),
  ('invoice.sent', 'invoice_due'),
  ('payment.received', 'payment_received'),
  ('review.request', 'review_request')
) AS v (event, template_name)
WHERE t.slug = 'palm-cleaners'
ON CONFLICT DO NOTHING;

-- WhatsApp conversations: 5 for existing seed customers (4 OPEN + 1 RESOLVED) --
INSERT INTO public.whatsapp_conversations (
  tenant_id, customer_id, phone_e164, status, last_message_at, unread_count,
  created_at, updated_at
)
SELECT
  t.id,
  (SELECT c.id FROM public.customers AS c
    WHERE c.tenant_id = t.id AND c.phone_e164 = v.phone_e164
      AND c.deleted_at IS NULL LIMIT 1),
  v.phone_e164, v.status,
  now() - (v.hours_ago || ' hours')::interval,
  v.unread_count,
  now() - interval '2 days', now()
FROM public.tenants AS t
CROSS JOIN (VALUES
  ('+255754882109', 'OPEN', 1, 2),
  ('+255713445902', 'OPEN', 2, 5),
  ('+255767990213', 'RESOLVED', 0, 30),
  ('+255718903467', 'OPEN', 0, 8),
  ('+255714298635', 'OPEN', 0, 20)
) AS v (phone_e164, status, unread_count, hours_ago)
WHERE t.slug = 'palm-cleaners'
  AND (SELECT c.id FROM public.customers AS c
    WHERE c.tenant_id = t.id AND c.phone_e164 = v.phone_e164
      AND c.deleted_at IS NULL LIMIT 1) IS NOT NULL
ON CONFLICT DO NOTHING;

-- WhatsApp messages: ~12 inbound (EN/SW mix) + outbound (sent/delivered/read) --
INSERT INTO public.whatsapp_messages (
  tenant_id, conversation_id, waba_message_id, kind, direction, body,
  template_name, template_params, status, created_at, updated_at
)
SELECT
  t.id,
  (SELECT wc.id FROM public.whatsapp_conversations AS wc
    WHERE wc.tenant_id = t.id AND wc.phone_e164 = v.phone_e164
      AND wc.deleted_at IS NULL LIMIT 1),
  v.waba_message_id, v.kind, v.direction, v.body,
  v.template_name, v.template_params::jsonb, v.status,
  now() - (v.hours_ago || ' hours')::interval,
  now() - (v.hours_ago || ' hours')::interval
FROM public.tenants AS t
CROSS JOIN (VALUES
  ('+255754882109', 'WAMID.SEED01', 'text', 'inbound', 'Habari, ningependa ku-book deep cleaning Jumamosi', NULL, NULL, 'delivered', 26),
  ('+255754882109', 'WAMID.SEED02', 'template', 'outbound', NULL, 'booking_confirmed', '{"customer_name": "Asha", "booking_ref": "BK-8962"}', 'read', 25),
  ('+255754882109', 'WAMID.SEED03', 'text', 'inbound', 'Asante! Mko wazi saa ngapi?', NULL, NULL, 'delivered', 2),
  ('+255713445902', 'WAMID.SEED04', 'text', 'inbound', 'Hi, is my quote ready yet?', NULL, NULL, 'delivered', 6),
  ('+255713445902', 'WAMID.SEED05', 'template', 'outbound', NULL, 'quote_sent', '{"customer_name": "Neema", "quote_ref": "QUO-1042"}', 'delivered', 5),
  ('+255713445902', 'WAMID.SEED06', 'text', 'inbound', 'Nimeipata, nitaiangalia na mume wangu', NULL, NULL, 'delivered', 5),
  ('+255767990213', 'WAMID.SEED07', 'text', 'inbound', 'The cleaners did a great job today, thanks!', NULL, NULL, 'delivered', 31),
  ('+255767990213', 'WAMID.SEED08', 'template', 'outbound', NULL, 'review_request', '{"customer_name": "David"}', 'read', 30),
  ('+255718903467', 'WAMID.SEED09', 'text', 'inbound', 'Je, mnaweza kuja Mikocheni kesho?', NULL, NULL, 'delivered', 9),
  ('+255718903467', 'WAMID.SEED10', 'text', 'outbound', 'Ndiyo Fatma, tunakuja kesho saa 3 asubuhi. Asante!', NULL, NULL, 'sent', 8),
  ('+255714298635', 'WAMID.SEED11', 'text', 'inbound', 'Please send me the invoice for last week', NULL, NULL, 'delivered', 21),
  ('+255714298635', 'WAMID.SEED12', 'template', 'outbound', NULL, 'invoice_due', '{"customer_name": "Mary", "invoice_ref": "INV-9004"}', 'delivered', 20)
) AS v (phone_e164, waba_message_id, kind, direction, body, template_name, template_params, status, hours_ago)
WHERE t.slug = 'palm-cleaners'
  AND (SELECT wc.id FROM public.whatsapp_conversations AS wc
    WHERE wc.tenant_id = t.id AND wc.phone_e164 = v.phone_e164
      AND wc.deleted_at IS NULL LIMIT 1) IS NOT NULL
ON CONFLICT DO NOTHING;

COMMIT;

-- ============================================================================
-- Phase 5 Track M fixtures (append-only; idempotent)
-- Reviews: 10 (4x5, 4x4, 1x3, 1x2) linked to BK-8962..BK-8971 + their customers.
-- One review per booking: idempotent via ON CONFLICT on (tenant_id,booking_id)
-- targeting the partial unique index (WHERE deleted_at IS NULL).
-- Run as a role that bypasses RLS (postgres / service_role), or inside a
-- transaction with row_security off, because tenant tables use FORCE RLS.
-- ============================================================================

BEGIN;
SET LOCAL row_security TO off;

INSERT INTO public.reviews (
  tenant_id, booking_id, customer_id, job_id, rating, comment, source,
  response, responded_by, responded_at, published, created_at, updated_at
)
SELECT
  t.id,
  bk.id,
  bk.customer_id,
  (SELECT j.id FROM public.jobs AS j
    WHERE j.tenant_id = t.id AND j.booking_id = bk.id
      AND j.deleted_at IS NULL LIMIT 1),
  v.rating, v.comment, v.source,
  v.response, NULL,
  CASE WHEN v.response IS NULL THEN NULL ELSE now() - (v.days_ago || ' days')::interval END,
  true,
  now() - (v.days_ago || ' days')::interval,
  now() - (v.days_ago || ' days')::interval
FROM public.tenants AS t
CROSS JOIN (VALUES
  ('BK-8962', 5, 'Team Alpha cleaned our whole house in Masaki top to bottom — floors, kitchen and bathrooms spotless. Best deep clean we have had in Dar.', 'portal', NULL, 1),
  ('BK-8963', 5, 'Hourly touch-up was quick and thorough, the team arrived on time and left everything neat. Asante sana!', 'whatsapp', NULL, 1),
  ('BK-8964', 4, 'Bedroom cleaning was very good, bedsheets and dusting done well. One window was missed but fixed after we mentioned it.', 'portal', NULL, 2),
  ('BK-8965', 4, 'Floor scrubbing machine work in Upanga was solid, tiles look new. Slight delay getting started but good finish.', 'whatsapp', NULL, 2),
  ('BK-8966', 5, 'Sofa shampoo and extraction removed stains we thought were permanent. Dried fast despite the Dar humidity. Highly recommend.', 'portal', NULL, 3),
  ('BK-8967', 4, 'Window panes inside and out are crystal clear now, Sinza dust is gone. Team was polite and careful with curtains.', 'portal', 'Asante Baraka! We are glad the windows came out well — Team Beta will keep it up.', 3),
  ('BK-8968', 5, 'Post-villa clean in Msasani was excellent, three hours of detailed work and the handover inspection passed. Worth every shilling.', 'whatsapp', 'Asante Fatma! Karibu tena — we are happy the villa handover passed inspection.', 4),
  ('BK-8969', 4, 'Office block contract cleaning is consistent week to week, washrooms and desks well kept. One missed bin once, otherwise reliable.', 'portal', NULL, 5),
  ('BK-8970', 3, 'Move-in refresh was okay, rooms mostly clean but skirting boards needed a second wipe. Fair for the price.', 'portal', NULL, 6),
  ('BK-8971', 2, 'Post-construction cleanup was cancelled twice before it happened and dust remained on the frames. Disappointed this time.', 'whatsapp', NULL, 7)
) AS v (booking_ref, rating, comment, source, response, days_ago)
JOIN public.bookings AS bk
  ON bk.tenant_id = t.id
 AND bk.reference = v.booking_ref
 AND bk.deleted_at IS NULL
WHERE t.slug = 'palm-cleaners'
  AND bk.id IS NOT NULL
  AND bk.customer_id IS NOT NULL
ON CONFLICT (tenant_id, booking_id) WHERE deleted_at IS NULL DO NOTHING;

COMMIT;
