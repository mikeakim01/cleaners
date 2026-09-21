# Safi — Cleaning Business Platform (Tanzania)

Bookings, customers, cleaners, jobs, invoices, payments, reviews and WhatsApp
communication — one multi-tenant platform for Tanzanian cleaning businesses.

> **Environment: never commit real credentials.** Copy `.env.example` to
> `.env.local` and fill in values from the dashboards listed in the
> [Env vars](#env-vars) table. All secrets below are placeholders.

---

## 1. Architecture

**Stack (see `package.json`):** Next.js `16.3.5` (App Router) · React `19.2.8` ·
TypeScript `strict` (`tsconfig.json`: `strict: true`, `@/*` → `./src/*`) ·
Tailwind CSS v4 (`@tailwindcss/postcss`, theme tokens in
`src/app/globals.css` via `@theme`) · hand-rolled `src/components/ui/*`
primitives built on `class-variance-authority` + `clsx` + `tailwind-merge`
(Button, Input, Select, Modal, Drawer, DatePicker, DataTable, … — no shadcn
dependency) · TanStack Query `5` (`src/providers.tsx`, `retry: 1`,
`refetchOnWindowFocus: false`) · React Hook Form `7` + Zod `4`
(`@hookform/resolvers`) · Recharts `3` (reports) · `date-fns` ·
`lucide-react` · Supabase (`@supabase/ssr` browser/server clients,
`@supabase/supabase-js` service-role admin) · `server-only` boundary marker.

**Layering (strict data-flow rule):**

```
components/domain + components/ui   (no DB access; ui/* are labelled primitives)
  → src/hooks/useX.ts               (TanStack Query wrappers, e.g. useBookings,
                                     useInvoices, useWhatsApp, useRequirePerm)
    → src/app/actions/*.actions.ts  (19 Server Actions: tenants, onboarding,
                                     bookings, jobs, calendar, customers,
                                     catalog, quotes, invoices, payments,
                                     whatsapp, employees, reviews, reports,
                                     dashboard, billing, admin, portal, public)
      → src/services/*.service.ts   (27 server-only modules; all inputs
                                     Zod-parsed; errors are human-readable
                                     AppError from src/lib/errors.ts;
                                     important actions call writeAudit)
        → Supabase Postgres         (via getSupabaseAdmin() service-role
                                     client or the request-scoped server
                                     client; every query scoped by tenant_id)
```

**Key supporting modules:**

- `src/server/tenant-context.ts` — slug-or-UUID tenant resolution +
  membership verification (`resolveTenant`, `assertTenantAccess`).
- `src/server/supabase-admin.ts` — cached service-role client (server only).
- `src/server/crypto.ts` — AES-256-GCM `encryptSecret`/`decryptSecret` for
  per-tenant WhatsApp tokens (`APP_ENCRYPTION_KEY`, `v1.<iv>.<cipher>`).
- `src/server/admin-guard.ts` — `requireSuperAdmin()` via
  `app_metadata.is_super_admin`.
- `src/server/whatsapp/cloud-api.ts` — Meta Graph API transport (send/test,
  timeouts, never logs tokens).
- `src/server/providers/payments.ts` — payment provider abstraction
  (`cash`, `bank_transfer`, `mobile_money`, `payment_link`, `stripe`).
- `src/rbac/permissions.ts` — 8 roles × 40 permissions, pure functions +
  deny-wins `extra_permissions` overrides.
- `src/lib/` — `pricing.ts` (7 pricing models, integer minor units),
  `portal-session.ts` (HMAC cookies), `format.ts`, `errors.ts`, `http.ts`,
  `trackf-types.ts` / `tracki-types.ts`, `wa-*` mappers, `supabase/client|server`.
- `src/i18n/en.json` — English UI strings (only locale shipped).
- `middleware.ts` — refreshes the Supabase auth session on every request
  (auth only; tenant membership is verified server-side in layouts/actions).

**Maps / payments / WhatsApp / email abstractions (honest picture):**

| Area      | Abstraction                        | Reality |
| --------- | ---------------------------------- | ------- |
| Payments  | `src/server/providers/payments.ts` | Real dispatch: cash/bank confirm instantly, `mobile_money` stays PENDING unless `MPESA_AUTO_CONFIRM=true`, `payment_link` PENDING, `stripe` is an honest stub (throws). |
| WhatsApp  | `src/server/whatsapp/cloud-api.ts` + `whatsapp*.service.ts` | Real Meta Cloud API transport; per-tenant tokens encrypted in `whatsapp_accounts.access_token_enc`. |
| Email     | Env keys only (`EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`) | No Resend/SMTP client is wired in `src/`; auth emails go through the Supabase Auth email provider. |
| Maps      | None | Booking detail links out to Google Maps (`https://maps.google.com/?q=…`); no distance/geocoding provider. |

**Routes (App Router groups):**

| URL | Source | Notes |
| --- | ------ | ----- |
| `/` | `src/app/page.tsx` | Marketing landing (`<main>` landmark). |
| `/login`, `/register` | `src/app/(auth)/…` | Supabase Auth; magic-link strings in `en.json`. |
| `/onboarding` | `src/app/(onboarding)/onboarding/page.tsx` | 10-step wizard (`step` 1–10 in `saveOnboardingDraft`). |
| `/[tenantSlug]/dashboard` + bookings, calendar, jobs, customers, services, quotes, invoices (+`/[reference]`), payments, whatsapp (+automations, connect, templates), employees, reviews, reports, billing | `src/app/(dashboard)/[tenantSlug]/…` | Tenant layout verifies membership via `getTenantBySlug`; per-tenant `--brand` theming. |
| `/b/[tenantSlug]`, `/b/[tenantSlug]/book` | `src/app/(public)/…` | Public booking pages (no login). |
| `/p/[tenantSlug]/portal` | `src/app/(portal)/…` | Customer portal (OTP + `portal_session` cookie). |
| `/[tenantSlug]/cleaner/…` | `src/app/(cleaner)/…` | Cleaner flow (job photos → `files` table, migration `00007`). |
| `/admin`, `/admin/tenants`, `/admin/tenants/[id]`, `/admin/plans`, `/admin/audit` | `src/app/(admin)/admin/…` | Super-admin only (`requireSuperAdmin`). |
| `GET /api/health` | `src/app/api/health/route.ts` | Returns `{ "ok": true }` (via `ok()` in `src/lib/http.ts`). |
| `GET+POST /api/webhooks/whatsapp` | `src/app/api/webhooks/whatsapp/route.ts` | Meta webhook (see §8). |

---

## 2. Env vars

Every key below exists in `.env.example` (copy to `.env.local`). Third column
says where to find the value.

| Key | Used by | Where to find it |
| --- | ------- | ---------------- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server anon clients | Supabase dashboard → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server anon clients | Supabase dashboard → Project Settings → API → anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | `src/server/supabase-admin.ts` only — **server only, never `NEXT_PUBLIC_`** | Supabase dashboard → Project Settings → API → service_role key |
| `NEXT_PUBLIC_APP_URL` | Booking/portal links, auth redirects, webhook callbacks | Your deployment URL (`http://localhost:3000` locally) |
| `NEXT_PUBLIC_DEFAULT_CURRENCY` | Price/invoice display default | Convention: `TZS` |
| `NEXT_PUBLIC_DEFAULT_TIMEZONE` | Date display default | IANA zone: `Africa/Dar_es_Salaam` |
| `APP_ENCRYPTION_KEY` | `src/server/crypto.ts` (WhatsApp tokens, portal sessions) | Generate: `openssl rand -base64 32` (32 bytes, base64) |
| `WHATSAPP_API_VERSION` | `src/server/whatsapp/cloud-api.ts` | Meta Graph version, e.g. `v21.0` |
| `WHATSAPP_APP_SECRET` | Webhook `X-Hub-Signature-256` check | Meta App Dashboard → Settings → Basic → App Secret |
| `WHATSAPP_VERIFY_TOKEN` | Webhook `GET` verification | Invent any random string; paste the same one in Meta webhook setup |
| `WHATSAPP_EMBEDDED_APP_ID` | Future Embedded Signup | Leave empty (stub) |
| `WHATSAPP_EMBEDDED_CONFIG_ID` | Future Embedded Signup | Leave empty (stub) |
| `MPESA_AUTO_CONFIRM` | `mobile_money` provider | Leave empty/`false`; set `true` only when a Daraja callback confirms receipts |
| `MPESA_CONSUMER_KEY` | M-Pesa Daraja (when enabled) | Vodacom Daraja portal |
| `MPESA_CONSUMER_SECRET` | M-Pesa Daraja (when enabled) | Vodacom Daraja portal |
| `MPESA_SHORTCODE` | M-Pesa Daraja (when enabled) | Vodacom Daraja portal (business shortcode) |
| `MPESA_PASSKEY` | M-Pesa Daraja (when enabled) | Vodacom Daraja portal |
| `MPESA_CALLBACK_URL` | Daraja result callback | `https://<your-app>/api/webhooks/…` (your deployment) |
| `STRIPE_SECRET_KEY` | `stripe` provider / `recordSubscriptionPayment` | Stripe dashboard → Developers → API keys (empty = card billing honestly disabled) |
| `STRIPE_WEBHOOK_SECRET` | Future Stripe webhooks | Stripe dashboard → Webhooks |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Future card UI | Stripe dashboard → API keys |
| `EMAIL_PROVIDER` | Reserved | Convention: `resend` (no client wired yet) |
| `RESEND_API_KEY` | Reserved | Resend dashboard (unused by `src/` today) |
| `EMAIL_FROM` | Reserved | Your verified sender (unused by `src/` today) |
| `SUPER_ADMIN_EMAILS` | Docs/ops hint; enforcement reads `app_metadata.is_super_admin` | Grant via SQL (see §11) |

---

## 3. Supabase setup

1. **Create a project** at the Supabase dashboard. Note the Project URL, anon
   key (→ `NEXT_PUBLIC_*`) and service-role key (→ `SUPABASE_SERVICE_ROLE_KEY`).
2. **Auth → Providers:** enable the **Email** provider. Add your
   `NEXT_PUBLIC_APP_URL` (e.g. `http://localhost:3000`) to redirect URLs so
   magic links / confirmations return to the app.
3. **Run migrations in filename order** (`supabase/migrations/` — 7 files) in
   the Supabase SQL editor (this repo has no `supabase/config.toml`, so the
   SQL editor is the canonical path; `IF NOT EXISTS` / `DROP POLICY IF EXISTS`
   make re-runs safe):

   | File | Contents |
   | ---- | -------- |
   | `00001_foundation.sql` | `tenants`, `tenant_members`, `business_settings`, `branches`, `plans`, `subscriptions`, `usage_counters`, `audit_logs`, `profiles` + Starter/Growth/Enterprise plan seed (TZS 95,000 / 150,000 / 300,000; 14/14/30 trial days) |
   | `00002_core_crm.sql` | `customers`, `services`, `bookings`, `quotes`, `quote_items`, `employees`, `teams`, `team_members`, `jobs`, `job_assignments`, `availability_slots` |
   | `00003_financial.sql` | `invoices`, `invoice_items`, `payments` (VAT-ready totals, minor-unit money) |
   | `00004_whatsapp.sql` | `whatsapp_accounts`, `whatsapp_templates`, `whatsapp_conversations`, `whatsapp_messages`, `whatsapp_automation_rules` |
   | `00005_portal.sql` | `reviews`, `customer_access_codes` (OTP hashes) |
   | `00006_billing.sql` | `subscription_events`, `platform_audit_logs`, `feature_flags` |
   | `00007_cleaner.sql` | `files` (immutable attachments) + private **`tenant-files`** storage bucket |

4. **Demo seed (optional):** `supabase/seed/palm-cleaners.seed.sql` (“Palm
   Cleaners”, Dar es Salaam). Run as a role that bypasses RLS
   (`service_role`/`postgres`) with `SET LOCAL row_security TO off;` — see the
   header comment in the seed file.
5. **Storage note:** the only bucket is the private `tenant-files` bucket
   (created by `00007` via `storage.buckets`). Deliberately **no**
   `storage.objects` policies for anon/authenticated — uploads go through
   server-only code (`src/services/files.service.ts`) with the service role,
   and clients receive short-lived signed URLs only.
6. **RLS model:** every tenant table uses `ENABLE ROW LEVEL SECURITY` +
   `FORCE ROW LEVEL SECURITY` with a `tenant_isolation` policy keyed on the
   `app.current_tenant` GUC plus `public.is_tenant_member(tenant_id)`.
   Verified counts: **34 tables, 36 policies** — 30× `tenant_isolation`,
   1× `plans_readable` (global catalogue), 3× `profiles` owner policies, 2×
   `platform_admin_only` (gated by `public.is_super_admin()`). The service
   layer additionally re-checks membership on every call (`requirePermission`
   / `resolveTenant`), so RLS is defence-in-depth, not the only gate.

---

## 4. Local dev

```bash
npm install        # install (lockfile is source of truth; avoid unless adding a dep)
npm run dev        # start dev server (http://localhost:3000)
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm test           # vitest run (single pass)
npm run test:watch # vitest watch mode
npm run build      # next build (production)
npm start          # serve the production build
```

All scripts are defined in `package.json`. Config: `vitest.config.ts`
(`environment: node`, `__tests__/**/*.test.ts`, `@/` alias, `server-only`
stub), `eslint.config.mjs`, `postcss.config.mjs`, `next.config.ts`.

---

## 5. Deployment (Vercel)

1. Connect the repo to Vercel (or run `npm run build && npm start` on any
   Node host). Build command: `next build` (the `build` script).
2. Set **all** `.env.example` variables in Project Settings → Environment
   Variables, with production values (`NEXT_PUBLIC_APP_URL` = your domain,
   Supabase **prod** project keys, `APP_ENCRYPTION_KEY`, WhatsApp + M-Pesa +
   Stripe as applicable).
3. On the **prod Supabase project**, run migrations `00001`→`00007` in order
   (the `plans` seed rows ship inside `00001`), plus the demo seed only if
   wanted.
4. **Post-deploy checklist:** update Supabase Auth redirect URLs to the prod
   domain; re-enter the webhook callback URL + verify token in the Meta App
   dashboard and hit `GET /api/webhooks/whatsapp` (403 = reachable but wrong
   token, which still proves routing); set `MPESA_CALLBACK_URL` if using
   Daraja; smoke-test `GET /api/health` (`{"ok":true}`); register a tenant and
   complete onboarding; confirm the trial banner counts down (trial expiry is
   processed by `processTrialExpiries` in `src/services/billing.service.ts`
   via cron/admin trigger).

---

## 6. WhatsApp setup (Meta Cloud API)

1. **Meta app:** create an app at Meta for Developers, add the WhatsApp
   product, and create/select a WhatsApp Business Account (WABA).
2. **Business verification note:** Meta may require Business verification
   before production messaging/throughput (typically 1–5 business days, per
   Meta docs — plan for it; development/test numbers work before that).
3. **Per-tenant connection:** in Settings → WhatsApp connect (or onboarding
   step 7), save the `phone_number_id` + WABA id; the access token is stored
   as `whatsapp_accounts.access_token_enc` encrypted with
   `APP_ENCRYPTION_KEY` (`encryptSecret`, `src/server/crypto.ts`). “Test
   connection” calls the Graph API with the stored pair. Seed rows use the
   obvious placeholder `v1.SEED.placeholder` — never a real token.
4. **Webhook:** subscribe `https://<app>/api/webhooks/whatsapp` in the Meta
   App dashboard with your `WHATSAPP_VERIFY_TOKEN` (Meta echoes
   `hub.verify_token`/`hub.challenge`; see §8) and the App Secret
   (`WHATSAPP_APP_SECRET`) used for `X-Hub-Signature-256` verification.
5. **Templates:** create Utility templates (the seed ships 8 EN approved-shape
   examples: `booking_confirmed`, `quote_sent`, `cleaner_enroute`,
   `cleaner_arrived`, `job_completed`, `invoice_due`, `payment_received`,
   `review_request`, plus 3 SW `PENDING` examples). Meta template review
   typically takes minutes to ~24h. Only `APPROVED` templates send
   (`triggerAutomationEvent` skips the rest with a `not-approved` reason).
6. **Embedded Signup:** stub only — `WHATSAPP_EMBEDDED_APP_ID` /
   `WHATSAPP_EMBEDDED_CONFIG_ID` stay empty until the signup flow is built.

---

## 7. Webhook config

- **Endpoint:** `/api/webhooks/whatsapp` (`src/app/api/webhooks/whatsapp/route.ts`).
- **Verification (`GET`):** requires `hub.mode=subscribe` and
  `hub.verify_token === WHATSAPP_VERIFY_TOKEN`; returns the `hub.challenge`
  as `text/plain` with 200, otherwise 403.
- **Events (`POST`):** reads the raw body, verifies `x-hub-signature-256`
  (HMAC-SHA256 hex of the raw body via `WHATSAPP_APP_SECRET`,
  `verifyWebhookSignature` in `src/services/whatsapp.service.ts`; accepts the
  `sha256=` prefix; 401 on mismatch), then loose-parses the payload
  (`parseWebhookPayload`).
- **200-always semantics:** after a valid signature the route **always**
  answers 200 (`{ ok: true, routed }`). `ingestParsedPayload`
  (`src/services/whatsapp-ingest.service.ts`) wraps every message/status in
  try/catch; one bad message never aborts the batch and never 500s to Meta.
- **Ingest behaviour:** routes by `phone_number_id` → tenant
  (`routeAccountByPhoneNumberId`; unknown numbers return `routed: false`,
  still 200); inbound texts auto-create minimal customers, resolve/create the
  conversation, insert the message (idempotent on `waba_message_id`), bump
  `unread_count`, and write a system audit row; status updates flip outbound
  rows through `sent → delivered → read` (`failed` records an error).
- **Rate limiting:** none yet — by design Meta retries on 4xx/5xx, so future
  throttling must use a queue (or 429 + `Retry-After`), never silent drops
  (see the comment at the top of the route).

---

## 8. Payments

- **Model:** all money is INTEGER minor units (TZS 95,000 = `9500000`;
  `src/lib/pricing.ts`). Invoice `total = subtotal − discount + vat +
  surcharge`; VAT 18% (`business_settings.vat_rate`).
- **Providers** (`src/server/providers/payments.ts`): `cash` and
  `bank_transfer` record `CONFIRMED` immediately; **`mobile_money` (M-Pesa)
  records `PENDING` until staff confirm it** — set
  `MPESA_AUTO_CONFIRM=true` only when a Daraja callback actually confirms
  receipts (silent auto-confirm would mark unpaid invoices paid). M-Pesa refs
  must match `/^[A-Z0-9]{8,16}$/` (e.g. `QA12B3C4D5`). `payment_link` is
  `PENDING`. `stripe` is an honest stub: without `STRIPE_SECRET_KEY` it
  throws “not configured”; with a key it still refuses to fabricate a charge
  and directs users to cash/bank/mobile-money.
- **Invoice flow:** payments attach to `SENT`/`PARTIAL`/`OVERDUE` invoices
  (`assertPaymentAllowedOnInvoice`, overpayment rejected by
  `assertPaymentWithinBalance`); each confirmed payment bumps
  `amount_paid_minor` and recomputes status (`recalcInvoiceStatus`:
  `PARTIAL` → `PAID`); customers can also self-report M-Pesa codes from the
  portal (`submitPortalPayment` → `PENDING` “payment claim”).
- **Subscription billing (manual flow):** `recordSubscriptionPayment`
  (`src/services/billing.service.ts`) accepts `manual_mpesa` / `manual_bank` /
  `stripe` refs, writes a `subscription_events.payment_recorded` row and
  extends `current_period_end` by 30 days — tenants pay via M-Pesa/bank
  transfer and staff record it; there is no automatic card charging.
  `changePlan` (OWNER-only `subscription:manage`) swaps plans immediately;
  `cancelSubscription` flips to `canceled`; trials (`trialing`, 14/30 days per
  plan) decay via `processTrialExpiries` → `past_due`.

---

## 9. Tenant creation

`Register → /onboarding` (10-step wizard; drafts persist per step to
`business_settings` via `saveOnboardingDraftAction`, steps 1–10) `→
/[tenantSlug]/dashboard`.

- Step 1 (Business Profile) calls `createTenantAction` → `createTenant`
  (`src/services/tenants.service.ts`, `CreateTenantInputSchema`): Zod-validated
  business name, globally-unique slug, `+255XXXXXXXXX` phone
  (`TANZANIA_PHONE_REGEX`), and branch records (`BranchInputSchema`); creates
  the tenant, an `owner` membership for the registering user, the branches,
  and an audit row.
- Continue through services, team, pricing, WhatsApp (step 7), portal and
  billing steps; step 10 goes live at `/[tenantSlug]/dashboard` with
  per-tenant `--brand` theming and a trial banner (`TrialBannerLoader`).

---

## 10. Admin setup

1. Register the platform owner normally, then grant super-admin in SQL:
   ```sql
   update auth.users
      set raw_app_meta_data = raw_app_meta_data || '{"is_super_admin":true}'
    where email = 'owner@example.com';
   ```
   (same statement is quoted in `.env.example`). Enforcement reads the
   **server-verified** user object (`isSuperAdminUser` /
   `requireSuperAdmin` in `src/server/admin-guard.ts`) — never headers.
2. Open `/admin`: overview (`admin/page.tsx`), tenant list
   (`admin/tenants`), tenant detail (`admin/tenants/[id]`), plans
   (`admin/plans`), platform audit (`admin/audit`).
3. **Impersonation audit:** every tenant-detail view writes dual audit rows
   (`buildImpersonationAudit` in `src/services/admin.service.ts`) — a
   `platform_audit_logs` entry plus a tenant `audit_logs` entry — so tenant
   data viewed through admin is always traceable.

---

## 11. Roles & permissions matrix

Roles (`src/rbac/permissions.ts`, mirroring the `tenant_members.role` CHECK):
`OWNER · ADMIN · MANAGER · SUPERVISOR · CLEANER · DRIVER · ACCOUNTANT ·
CUSTOMER_SUPPORT`. `OWNER` holds `*` (all 40 permissions). Deltas below
(`✓` = granted; enforced server-side via `requirePermission`):

| Capability | ADMIN | MANAGER | SUPERVISOR | CLEANER | DRIVER | ACCOUNTANT | SUPPORT |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| bookings create/read/update | ✓ | ✓ | ✓ (no cancel) | read/update | read/update | read | ✓ |
| bookings cancel / assign | ✓ | cancel ✓ / assign ✓ | assign ✓ | — | — | — | — |
| customers create/update/delete | ✓ | create/update | read/update | read | read | read/update | create/update |
| services / branches manage | ✓ | create+update / read | read | read | read | read | read (services) |
| users invite/update/deactivate | ✓ | read | — | — | — | — | — |
| settings update / audit read | ✓ | — | — | — | — | read / ✓ | — |
| reports read / export | ✓ | ✓ | read | — | — | ✓ | read |
| payments record / refund | ✓ | record | — | — | — | ✓ | — |
| subscription read / manage | read / — | read / — | — | — | — | read / — | — |
| whatsapp read/send/connect/templates | ✓ | read/send | read/send | — | — | — | read/send |
| reviews read / respond | ✓ | ✓ | read | — | — | read | read |

`subscription:manage` is OWNER-only (billing stays with the owner).
Per-membership `extra_permissions` (`{ allow[], deny[] }`) apply **deny-first**:
`deny > allow > role defaults`; unknown roles/permissions fail closed.

---

## 12. Booking lifecycle (16 states)

`BOOKING_STATUSES` + `ALLOWED_TRANSITIONS` (`src/services/bookings.service.ts`;
same list in `src/lib/trackf-types.ts`). Cancelling requires
`bookings:cancel`; every other move requires `bookings:update`. References are
`PREFIX + (1000 + count)` (`BK-1000…`, prefix from `business_settings`).

```
NEW → PENDING_REVIEW →+-→ CONFIRMED → SCHEDULED → ASSIGNED → EN_ROUTE
 │         │          |    (or QUOTE_REQUIRED → QUOTE_SENT → AWAITING_CUSTOMER
 │         │          |     → CONFIRMED / QUOTE_REQUIRED …)
 │         │          └→ (CANCELLED / REJECTED)
 └→ CANCELLED / REJECTED
… → ARRIVED → IN_PROGRESS → COMPLETED → PAYMENT_PENDING → PAID  (terminal)
CANCELLED / REJECTED / PAID are terminal (no outgoing transitions).
```

Full map: `NEW: [PENDING_REVIEW, CANCELLED, REJECTED]`,
`PENDING_REVIEW: [QUOTE_REQUIRED, CONFIRMED, CANCELLED, REJECTED]`,
`QUOTE_REQUIRED: [QUOTE_SENT, CANCELLED]`,
`QUOTE_SENT: [AWAITING_CUSTOMER, CANCELLED]`,
`AWAITING_CUSTOMER: [CONFIRMED, QUOTE_REQUIRED, CANCELLED, REJECTED]`,
`CONFIRMED: [SCHEDULED, CANCELLED]`, `SCHEDULED: [ASSIGNED, CANCELLED]`,
`ASSIGNED: [EN_ROUTE, CANCELLED]`, `EN_ROUTE: [ARRIVED]`,
`ARRIVED: [IN_PROGRESS]`, `IN_PROGRESS: [COMPLETED]`,
`COMPLETED: [PAYMENT_PENDING]`, `PAYMENT_PENDING: [PAID]`.
`CONFIRMED` fires best-effort WhatsApp automation (`booking.confirmed`) without
breaking the transition. Slug-or-reference lookups accept UUID **or**
`reference` (`getBooking`, `transitionBookingByReference`).

---

## 13. Testing

`npm test` (`vitest run`; watch via `npm run test:watch`). Suites in
`__tests__/` (14 `*.test.ts` + `server-only-stub.ts` helper that maps the
`server-only` boundary to a no-op so services stay unit-testable under node):

`pricing` · `rbac` · `tenant-isolation` (cross-tenant access rejected) ·
`phase2-bookings` · `phase2-jobs` · `phase2-quotes` ·
`phase3-invoices` · `phase3-payments` · `phase4-templates` ·
`phase4-webhook` · `phase5-portal` · `phase5-public` ·
`phase6-admin` · `phase6-billing`.

Pure helpers (`canTransitionBooking`, `calculatePrice`, `hasPermission`,
`trialDaysLeft`, `pickExpiredTrials`, `hashAccessCode`, …) are exported for
tests; services accept an injectable `db` client so tests run without a live
database.

---

## 14. Security model

- **Server-only boundary:** all 27 `src/services/*.service.ts` modules and all
  6 `src/server/**` modules open with `import "server-only"` — importing them
  from a Client Component fails the build.
- **RLS:** 34 tables / 36 policies (§3); `FORCE RLS` + `tenant_isolation`
  everywhere tenant-scoped; private storage with no anon policies.
- **Slug-or-id resolution:** dashboard URLs carry slugs; `resolveTenant`
  resolves them server-side via the service role and verifies membership —
  client-supplied tenant ids are claims, never trusted
  (`TenantAccessDeniedError` otherwise).
- **RBAC:** `requirePermission` at the top of every mutating service;
  deny-wins overrides; super-admin via verified `app_metadata`.
- **OTP sessions:** portal login codes are 6-digit, stored as SHA-256 hashes
  (`hashAccessCode`), compared timing-safe (`codesMatch`), 10-minute TTL,
  max 5 attempts, generic responses (no user-enumeration), single-use.
- **HMAC cookies:** `portal_session` = `base64url(payload).hmac-sha256`
  (`src/lib/portal-session.ts`, `timingSafeEqual`, 30-day expiry); portal
  data access re-scopes by `(tenantId, customerId)` from the verified cookie.
- **Signature verification:** Meta webhooks HMAC-checked before any ingest;
  Stripe/M-Pesa secrets never leave the server.

---

## 15. Known gaps / hardening backlog

- **Public rate limiting:** none on `/api/webhooks/whatsapp` or public
  booking/portal endpoints yet (webhook must stay 200-friendly; use a queue
  or 429 + `Retry-After`, per the route comment).
- **EFD fiscalisation:** `business_settings` stores TIN/VRN/invoice prefixes,
  but no TRA EFD receipt integration exists.
- **Realtime-via-polling:** WhatsApp inbox polls (`refetchInterval` 5–8s in
  `src/hooks/useWhatsApp.ts`) because RLS session GUCs are incompatible with
  anon Realtime channels — no live subscriptions yet.
- **Service-worker offline:** none (`public/` ships only stock SVGs); field
  flows (cleaner photos) need connectivity.
- **Session impersonation read-only:** admin tenant views are dual-audited
  but there is no dedicated read-only impersonation session mode.

---

## Appendix: demo seed

`supabase/seed/palm-cleaners.seed.sql` provisions the `palm-cleaners` tenant
(Masaki HQ + Mikocheni + Kariakoo branches): 10 services (all 7 pricing
models), 8 employees, 3 teams, 10 customers, 10 bookings (`BK-8962…BK-8971`),
10 jobs, 5 invoices + 5 payments, WhatsApp account/templates/conversations,
and 10 reviews. Idempotent via `ON CONFLICT DO NOTHING` guards (see the Track
U verification report for exact coverage notes).
