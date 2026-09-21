import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, humanizeDbError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/server/supabase-admin";
import { writeAudit } from "@/services/audit.service";
import { PlanLimitsSchema } from "@/services/subscriptions.service";
import { summarizeUsage } from "@/services/billing.service";
import {
  NotSuperAdminError,
  requireSuperAdmin as guardRequireSuperAdmin,
} from "@/server/admin-guard";

export { NotSuperAdminError };

/**
 * Local wrapper preserving the admin.service contract (resolves to the
 * admin user id). Delegates enforcement to the shared server guard so
 * there is exactly one super-admin check in the codebase.
 */
export async function requireSuperAdmin(): Promise<string> {
  const { userId } = await guardRequireSuperAdmin();
  return userId;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in __tests__/phase6-admin.test.ts)
// ---------------------------------------------------------------------------

/** Human message for (un)suspending a tenant. */
export function suspendedMessage(suspended: boolean): string {
  return suspended ? "Tenant suspended." : "Tenant reactivated.";
}

export interface ImpersonationAuditInput {
  adminId: string;
  tenantId: string;
}

/**
 * Pure payload builder for the double audit trail written on every admin
 * tenant view: a platform-level record plus a tenant-visible record.
 */
export function buildImpersonationAudit(input: ImpersonationAuditInput): {
  platform: { actorUserId: string; action: string; tenantId: string; metadata: Record<string, unknown> };
  tenant: { action: string; metadata: Record<string, unknown> };
} {
  return {
    platform: {
      actorUserId: input.adminId,
      action: "admin.tenant_viewed",
      tenantId: input.tenantId,
      metadata: { adminId: input.adminId },
    },
    tenant: {
      action: "admin.impersonated",
      metadata: { adminId: input.adminId },
    },
  };
}

// ---------------------------------------------------------------------------
// Shared DB helpers
// ---------------------------------------------------------------------------

type Db = SupabaseClient;
function dbOrAdmin(db?: Db): Db {
  return db ?? getSupabaseAdmin();
}

function checkTenantId(tenantId: string): void {
  const parsed = z.uuid("Invalid business.").safeParse(tenantId);
  if (!parsed.success) throw new AppError("Invalid business.");
}

/** Platform-level audit insert (platform_audit_logs has no entity columns). */
async function writePlatformAudit(
  client: Db,
  input: { actorUserId: string; action: string; tenantId?: string | null; metadata?: Record<string, unknown>; ip?: string },
): Promise<void> {
  try {
    const { error } = await client.from("platform_audit_logs").insert({
      actor_user_id: input.actorUserId,
      action: input.action,
      tenant_id: input.tenantId ?? null,
      metadata: input.metadata ?? {},
      ip: input.ip ?? null,
    });
    if (error) throw error;
  } catch {
    // Platform audit is best-effort; admin reads/writes must not break on it.
  }
}

interface SubRow {
  tenant_id: string;
  plan_id: string;
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  created_at: string;
}

/** Latest non-deleted subscription per tenant, resolved in JS (admin scale). */
async function latestSubsByTenant(client: Db, tenantIds?: string[]): Promise<Map<string, SubRow>> {
  let query = client
    .from("subscriptions")
    .select("tenant_id, plan_id, status, trial_ends_at, current_period_end, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (tenantIds && tenantIds.length > 0) query = query.in("tenant_id", tenantIds);
  const { data, error } = await query;
  if (error) throw error;
  const map = new Map<string, SubRow>();
  for (const row of ((data ?? []) as SubRow[])) {
    if (!map.has(row.tenant_id)) map.set(row.tenant_id, row);
  }
  return map;
}

// ---------------------------------------------------------------------------
// getPlatformStats
// ---------------------------------------------------------------------------

export interface PlanDistribution {
  planName: string;
  count: number;
}

export interface PlatformStats {
  tenantsTotal: number;
  tenantsActive: number;
  trialing: number;
  pastDue: number;
  usersTotal: number;
  bookingsTotal: number;
  mrrMinor: number;
  trialsExpiring: number;
  planDistribution: PlanDistribution[];
}

export async function getPlatformStats(db?: Db): Promise<PlatformStats> {
  await requireSuperAdmin();
  const client = dbOrAdmin(db);

  try {
    const [{ data: tenants, error: tenantsError }, { data: plans, error: plansError }] = await Promise.all([
      client.from("tenants").select("id, suspended").is("deleted_at", null).limit(2000),
      client.from("plans").select("id, name, price_monthly_minor").is("deleted_at", null),
    ]);
    if (tenantsError) throw tenantsError;
    if (plansError) throw plansError;

    const tenantRows = ((tenants ?? []) as Array<{ id: string; suspended: boolean }>);
    const planRows = ((plans ?? []) as Array<{ id: string; name: string; price_monthly_minor: number }>);
    const planById = new Map(planRows.map((p) => [p.id, p]));

    const subs = await latestSubsByTenant(client);
    let trialing = 0;
    let pastDue = 0;
    let mrrMinor = 0;
    const dist = new Map<string, number>();
    const nowPlus72h = Date.now() + 72 * 3_600_000;
    let trialsExpiring = 0;
    for (const sub of subs.values()) {
      if (sub.status === "trialing") {
        trialing += 1;
        const end = sub.trial_ends_at ? new Date(sub.trial_ends_at).getTime() : NaN;
        if (Number.isFinite(end) && end < nowPlus72h) trialsExpiring += 1;
      }
      if (sub.status === "past_due") pastDue += 1;
      const plan = planById.get(sub.plan_id);
      const name = plan?.name ?? "Unknown";
      dist.set(name, (dist.get(name) ?? 0) + 1);
      if (sub.status === "active" && plan) mrrMinor += plan.price_monthly_minor;
    }

    const [{ count: usersTotal }, { count: bookingsTotal }] = await Promise.all([
      client.from("tenant_members").select("id", { count: "exact", head: true }).is("deleted_at", null),
      client.from("bookings").select("id", { count: "exact", head: true }).is("deleted_at", null),
    ]);

    return {
      tenantsTotal: tenantRows.length,
      tenantsActive: tenantRows.filter((t) => !t.suspended).length,
      trialing,
      pastDue,
      usersTotal: usersTotal ?? 0,
      bookingsTotal: bookingsTotal ?? 0,
      mrrMinor,
      trialsExpiring,
      planDistribution: [...dist.entries()].map(([planName, count]) => ({ planName, count })),
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load platform statistics"));
  }
}

// ---------------------------------------------------------------------------
// listAllTenants
// ---------------------------------------------------------------------------

export const ListAllTenantsFilterSchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(["all", "active", "suspended", "trialing", "past_due"]).optional().default("all"),
});
export type ListAllTenantsFilter = z.infer<typeof ListAllTenantsFilterSchema>;

export interface AdminTenantRow {
  id: string;
  slug: string;
  name: string;
  phone: string | null;
  suspended: boolean;
  planName: string | null;
  subscriptionStatus: string | null;
  users: number;
  bookingsVolume: number;
  trialEndsAt: string | null;
  createdAt: string;
}

export async function listAllTenants(rawFilter: unknown = {}, db?: Db): Promise<AdminTenantRow[]> {
  await requireSuperAdmin();
  const parsed = ListAllTenantsFilterSchema.safeParse(rawFilter ?? {});
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid filter.");
  const filter = parsed.data;
  const client = dbOrAdmin(db);

  try {
    // N+1 with a hard limit of 100 rows is fine at admin scale.
    let query = client
      .from("tenants")
      .select("id, slug, name, phone_e164, suspended, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100);
    if (filter.search) {
      const s = filter.search.replace(/[%_]/g, "");
      query = query.or(`name.ilike.%${s}%,slug.ilike.%${s}%`);
    }
    if (filter.status === "active") query = query.eq("suspended", false);
    if (filter.status === "suspended") query = query.eq("suspended", true);
    const { data: tenants, error } = await query;
    if (error) throw error;
    const rows = ((tenants ?? []) as Array<{ id: string; slug: string; name: string; phone_e164: string | null; suspended: boolean; created_at: string }>);
    const ids = rows.map((t) => t.id);

    const [subs, planRows] = await Promise.all([
      ids.length > 0 ? latestSubsByTenant(client, ids) : Promise.resolve(new Map<string, SubRow>()),
      client.from("plans").select("id, name").is("deleted_at", null),
    ]);
    const planNameById = new Map(((planRows.data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]));

    const enriched = await Promise.all(
      rows.map(async (t) => {
        const sub = subs.get(t.id) ?? null;
        const [{ count: users }, { count: bookingsVolume }] = await Promise.all([
          client.from("tenant_members").select("id", { count: "exact", head: true }).eq("tenant_id", t.id).is("deleted_at", null),
          client.from("bookings").select("id", { count: "exact", head: true }).eq("tenant_id", t.id).is("deleted_at", null),
        ]);
        return {
          id: t.id,
          slug: t.slug,
          name: t.name,
          phone: t.phone_e164,
          suspended: t.suspended,
          planName: sub ? (planNameById.get(sub.plan_id) ?? null) : null,
          subscriptionStatus: sub?.status ?? null,
          users: users ?? 0,
          bookingsVolume: bookingsVolume ?? 0,
          trialEndsAt: sub?.trial_ends_at ?? null,
          createdAt: t.created_at,
        } satisfies AdminTenantRow;
      }),
    );

    if (filter.status === "trialing") return enriched.filter((r) => r.subscriptionStatus === "trialing");
    if (filter.status === "past_due") return enriched.filter((r) => r.subscriptionStatus === "past_due");
    return enriched;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load businesses"));
  }
}

// ---------------------------------------------------------------------------
// getTenantDetail (every view is impersonation-audited)
// ---------------------------------------------------------------------------

export interface TenantDetail {
  tenant: { id: string; slug: string; name: string; phone: string | null; suspended: boolean; createdAt: string };
  subscription: {
    id: string | null;
    status: string;
    planName: string;
    priceMinor: number;
    currency: string;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
  } | null;
  usage: Array<{ key: string; used: number; limit: number; unlimited: boolean }>;
  counts: { customers: number; bookings: number; jobs: number; invoices: number; revenueMinor: number };
  members: Array<{ userId: string; role: string; name: string | null; email: string | null }>;
  recentAudit: Array<{ id: string; action: string; created_at: string }>;
}

export async function getTenantDetail(tenantId: string, db?: Db): Promise<TenantDetail> {
  const adminId = await requireSuperAdmin();
  checkTenantId(tenantId);
  const client = dbOrAdmin(db);

  try {
    const { data: tenant, error: tenantError } = await client
      .from("tenants")
      .select("id, slug, name, phone_e164, suspended, created_at")
      .eq("id", tenantId)
      .is("deleted_at", null)
      .maybeSingle();
    if (tenantError) throw tenantError;
    if (!tenant) throw new AppError("We could not find that business.");
    const t = tenant as { id: string; slug: string; name: string; phone_e164: string | null; suspended: boolean; created_at: string };

    const { data: subData, error: subError } = await client
      .from("subscriptions")
      .select("id, plan_id, status, trial_ends_at, current_period_end, plans ( name, price_monthly_minor, currency, limits )")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (subError) throw subError;
    const sub = subData as unknown as {
      id: string; plan_id: string; status: string; trial_ends_at: string | null; current_period_end: string | null;
      plans: { name: string; price_monthly_minor: number; currency: string; limits: unknown } | Array<{ name: string; price_monthly_minor: number; currency: string; limits: unknown }> | null;
    } | null;
    const plan = sub ? (Array.isArray(sub.plans) ? (sub.plans[0] ?? null) : sub.plans) : null;
    const limits = PlanLimitsSchema.parse(plan?.limits ?? {});

    const period = new Date().toISOString().slice(0, 7);
    const [branches, staff, bookingsCounter, whatsappCounter, customers, bookings, jobs, invoices, payments, members, audit] = await Promise.all([
      client.from("usage_counters").select("count").eq("tenant_id", tenantId).eq("metric", "branches").eq("period", "all_time").is("deleted_at", null).maybeSingle(),
      client.from("usage_counters").select("count").eq("tenant_id", tenantId).eq("metric", "staff").eq("period", "all_time").is("deleted_at", null).maybeSingle(),
      client.from("usage_counters").select("count").eq("tenant_id", tenantId).eq("metric", "bookings_per_month").eq("period", period).is("deleted_at", null).maybeSingle(),
      client.from("usage_counters").select("count").eq("tenant_id", tenantId).eq("metric", "whatsapp_messages").eq("period", period).is("deleted_at", null).maybeSingle(),
      client.from("customers").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).is("deleted_at", null),
      client.from("bookings").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).is("deleted_at", null),
      client.from("jobs").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).is("deleted_at", null),
      client.from("invoices").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).is("deleted_at", null),
      client.from("payments").select("amount_minor").eq("tenant_id", tenantId).eq("status", "CONFIRMED").is("deleted_at", null),
      client.from("tenant_members").select("user_id, role").eq("tenant_id", tenantId).is("deleted_at", null),
      client.from("audit_logs").select("id, action, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(20),
    ]);

    const countOf = (r: { count: number | null } | { data?: unknown } | null): number => {
      const c = (r as { count?: number | null })?.count;
      return c ?? 0;
    };
    const counterOf = (r: unknown): number => ((r as { data?: { count?: number } | null })?.data as { count?: number } | null)?.count ?? 0;
    const revenueMinor = ((payments.data ?? []) as Array<{ amount_minor: number }>).reduce((s, p) => s + (p.amount_minor ?? 0), 0);

    // Member directory enrichment (best-effort): profile names + auth emails.
    const memberRows = ((members.data ?? []) as Array<{ user_id: string; role: string }>);
    const memberIds = memberRows.map((m) => m.user_id);
    const [profileRows, emailById] = await (async (): Promise<
      [Array<{ user_id: string; full_name: string | null }>, Map<string, string>]
    > => {
      if (memberIds.length === 0) return [[], new Map()];
      let profiles: Array<{ user_id: string; full_name: string | null }> = [];
      try {
        const { data } = await client
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", memberIds);
        profiles = ((data ?? []) as Array<{ user_id: string; full_name: string | null }>);
      } catch {
        profiles = [];
      }
      const emails = new Map<string, string>();
      await Promise.all(
        memberIds.map(async (id) => {
          try {
            const { data, error } = await client.auth.admin.getUserById(id);
            if (!error && data?.user?.email) emails.set(id, data.user.email);
          } catch {
            // Leave the email blank rather than failing the whole snapshot.
          }
        }),
      );
      return [profiles, emails];
    })();
    const nameById = new Map(profileRows.map((p) => [p.user_id, p.full_name]));

    // Every admin view is logged twice: platform trail + tenant-visible trail.
    const impersonation = buildImpersonationAudit({ adminId, tenantId });
    await writePlatformAudit(client, {
      actorUserId: impersonation.platform.actorUserId,
      action: impersonation.platform.action,
      tenantId,
      metadata: impersonation.platform.metadata,
    });
    await writeAudit(
      { tenantId, userId: adminId, action: impersonation.tenant.action, entity: "tenant", entityId: tenantId, metadata: impersonation.tenant.metadata },
      { throwOnError: false },
      client,
    );

    return {
      tenant: { id: t.id, slug: t.slug, name: t.name, phone: t.phone_e164, suspended: t.suspended, createdAt: t.created_at },
      subscription: sub
        ? {
            id: sub.id,
            status: sub.status,
            planName: plan?.name ?? "Free Trial",
            priceMinor: plan?.price_monthly_minor ?? 0,
            currency: plan?.currency ?? "TZS",
            trialEndsAt: sub.trial_ends_at,
            currentPeriodEnd: sub.current_period_end,
          }
        : null,
      usage: summarizeUsage(
        { branches: counterOf(branches), staff: counterOf(staff), bookings_per_month: counterOf(bookingsCounter), whatsapp_messages: counterOf(whatsappCounter) },
        limits,
      ),
      counts: {
        customers: countOf(customers as { count: number | null }),
        bookings: countOf(bookings as { count: number | null }),
        jobs: countOf(jobs as { count: number | null }),
        invoices: countOf(invoices as { count: number | null }),
        revenueMinor,
      },
      members: memberRows.map((m) => ({
        userId: m.user_id,
        role: m.role,
        name: nameById.get(m.user_id) ?? null,
        email: emailById.get(m.user_id) ?? null,
      })),
      recentAudit: ((audit.data ?? []) as TenantDetail["recentAudit"]),
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load this business"));
  }
}

// ---------------------------------------------------------------------------
// setTenantSuspended
// ---------------------------------------------------------------------------

export const SetSuspendedInputSchema = z.object({
  suspended: z.boolean(),
  reason: z.string().trim().max(500).optional().default(""),
});
export type SetSuspendedInput = z.infer<typeof SetSuspendedInputSchema>;

export async function setTenantSuspended(
  tenantId: string,
  rawInput: unknown,
  db?: Db,
): Promise<{ suspended: boolean; message: string }> {
  const adminId = await requireSuperAdmin();
  checkTenantId(tenantId);
  const parsed = SetSuspendedInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request.");
  const client = dbOrAdmin(db);

  try {
    const { error } = await client.from("tenants").update({ suspended: parsed.data.suspended }).eq("id", tenantId);
    if (error) throw error;

    const metadata = { suspended: parsed.data.suspended, reason: parsed.data.reason || null };
    await writePlatformAudit(client, { actorUserId: adminId, action: "admin.tenant_suspended", tenantId, metadata });
    await writeAudit(
      { tenantId, userId: adminId, action: parsed.data.suspended ? "admin.suspended" : "admin.reactivated", entity: "tenant", entityId: tenantId, metadata },
      { throwOnError: false },
      client,
    );

    return { suspended: parsed.data.suspended, message: suspendedMessage(parsed.data.suspended) };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not update this business"));
  }
}

// ---------------------------------------------------------------------------
// Admin plan CRUD
// ---------------------------------------------------------------------------

export interface Plan {
  id: string;
  name: string;
  price_monthly_minor: number;
  currency: string;
  trial_days: number;
  limits: unknown;
  features: unknown;
  active: boolean;
}

export async function listPlans(db?: Db): Promise<Plan[]> {
  await requireSuperAdmin();
  const client = dbOrAdmin(db);
  try {
    const { data, error } = await client
      .from("plans")
      .select("id, name, price_monthly_minor, currency, trial_days, limits, features, active")
      .is("deleted_at", null)
      .order("name", { ascending: true });
    if (error) throw error;
    return ((data ?? []) as Plan[]);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load plans"));
  }
}

export const CreatePlanInputSchema = z.object({
  name: z.string().trim().min(2, "Plan name must be at least 2 characters.").max(60),
  priceMinor: z.number().int("Price must be a whole number of cents.").min(0, "Price cannot be negative."),
  currency: z.string().trim().min(3).max(3).optional().default("TZS"),
  trialDays: z.number().int("Trial days must be a whole number.").min(0, "Trial days cannot be negative.").optional().default(14),
  limits: PlanLimitsSchema.partial().optional().default({}),
  features: z.array(z.string().trim().min(1).max(120)).max(50).optional().default([]),
});
export type CreatePlanInput = z.infer<typeof CreatePlanInputSchema>;

export async function createPlan(rawInput: unknown, db?: Db): Promise<Plan> {
  const adminId = await requireSuperAdmin();
  const parsed = CreatePlanInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check the plan and try again.");
  const client = dbOrAdmin(db);

  try {
    const { data, error } = await client
      .from("plans")
      .insert({
        name: parsed.data.name,
        price_monthly_minor: parsed.data.priceMinor,
        currency: parsed.data.currency,
        trial_days: parsed.data.trialDays,
        limits: parsed.data.limits,
        features: parsed.data.features,
        active: true,
      })
      .select()
      .single();
    if (error) throw error;
    const plan = data as Plan;
    await writePlatformAudit(client, { actorUserId: adminId, action: "admin.plan_created", metadata: { planId: plan.id, name: plan.name } });
    return plan;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not create this plan"));
  }
}

export const UpdatePlanInputSchema = z.object({
  planId: z.uuid("Invalid plan."),
  name: z.string().trim().min(2, "Plan name must be at least 2 characters.").max(60).optional(),
  priceMinor: z.number().int("Price must be a whole number of cents.").min(0, "Price cannot be negative.").optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  trialDays: z.number().int("Trial days must be a whole number.").min(0, "Trial days cannot be negative.").optional(),
  limits: PlanLimitsSchema.partial().optional(),
  features: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  active: z.boolean().optional(),
});
export type UpdatePlanInput = z.infer<typeof UpdatePlanInputSchema>;

export async function updatePlan(rawInput: unknown, db?: Db): Promise<Plan> {
  const adminId = await requireSuperAdmin();
  const parsed = UpdatePlanInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check the plan and try again.");
  const { planId, ...patch } = parsed.data;
  const client = dbOrAdmin(db);

  try {
    const updates: Record<string, unknown> = {};
    if (patch.name !== undefined) updates.name = patch.name;
    if (patch.priceMinor !== undefined) updates.price_monthly_minor = patch.priceMinor;
    if (patch.currency !== undefined) updates.currency = patch.currency;
    if (patch.trialDays !== undefined) updates.trial_days = patch.trialDays;
    if (patch.limits !== undefined) updates.limits = patch.limits;
    if (patch.features !== undefined) updates.features = patch.features;
    if (patch.active !== undefined) updates.active = patch.active;
    if (Object.keys(updates).length === 0) throw new AppError("Nothing to update. Change at least one field.");

    const { data, error } = await client.from("plans").update(updates).eq("id", planId).select().single();
    if (error) throw error;
    const plan = data as Plan;
    await writePlatformAudit(client, { actorUserId: adminId, action: "admin.plan_updated", metadata: { planId, updates: Object.keys(updates) } });
    return plan;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not update this plan"));
  }
}

export async function deactivatePlan(planId: string, db?: Db): Promise<{ message: string }> {
  const adminId = await requireSuperAdmin();
  const parsed = z.uuid("Invalid plan.").safeParse(planId);
  if (!parsed.success) throw new AppError("Invalid plan.");
  const client = dbOrAdmin(db);

  try {
    const { count, error: countError } = await client
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", planId)
      .is("deleted_at", null)
      .in("status", ["trialing", "active", "past_due"]);
    if (countError) throw countError;
    if ((count ?? 0) > 0) {
      throw new AppError(`${count} tenants are still on this plan. Move them to another plan first.`);
    }

    const { error } = await client.from("plans").update({ active: false }).eq("id", planId);
    if (error) throw error;
    await writePlatformAudit(client, { actorUserId: adminId, action: "admin.plan_deactivated", metadata: { planId } });
    return { message: "Plan deactivated." };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not deactivate this plan"));
  }
}

// ---------------------------------------------------------------------------
// listPlatformAudit
// ---------------------------------------------------------------------------

export interface PlatformAuditRow {
  id: string;
  actor_user_id: string | null;
  action: string;
  tenant_id: string | null;
  metadata: unknown;
  created_at: string;
}

export async function listPlatformAudit(rawLimit: unknown = 50, db?: Db): Promise<PlatformAuditRow[]> {
  await requireSuperAdmin();
  const limit = Math.min(Math.max(Number(rawLimit) || 50, 1), 200);
  const client = dbOrAdmin(db);
  try {
    const { data, error } = await client
      .from("platform_audit_logs")
      .select("id, actor_user_id, action, tenant_id, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as PlatformAuditRow[]);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load platform activity"));
  }
}
