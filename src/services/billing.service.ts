import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, humanizeDbError } from "@/lib/errors";
import { formatMoney } from "@/lib/format";
import { getSupabaseAdmin } from "@/server/supabase-admin";
import { writeAudit } from "@/services/audit.service";
import { requirePermission } from "@/services/rbac.service";
import { PlanLimitsSchema, type PlanLimits } from "@/services/subscriptions.service";

// Track Q owns this file (Phase 6 Track Q). Verified in
// src/rbac/permissions.ts: both 'subscription:read' and
// 'subscription:manage' exist, so no 'settings:*' fallback is needed.

export const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "canceled", "paused"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_EVENT_TYPES = [
  "trial_started",
  "trial_ending",
  "trial_expired",
  "plan_changed",
  "subscription_activated",
  "payment_recorded",
  "payment_failed",
  "subscription_canceled",
  "subscription_paused",
  "subscription_resumed",
] as const;
export type SubscriptionEventType = (typeof SUBSCRIPTION_EVENT_TYPES)[number];

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in __tests__/phase6-billing.test.ts)
// ---------------------------------------------------------------------------

/** Whole days left on a trial, floored at 0. A missing trial end means no trial. */
export function trialDaysLeft(trialEndsAt: string | null | undefined, now: Date = new Date()): number {
  if (!trialEndsAt) return 0;
  const end = new Date(trialEndsAt).getTime();
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, Math.ceil((end - now.getTime()) / DAY_MS));
}

/** True when there is no usable trial time left. */
export function isTrialExpired(trialEndsAt: string | null | undefined, now: Date = new Date()): boolean {
  return trialDaysLeft(trialEndsAt, now) <= 0;
}

/** Human price label for a plan, e.g. formatMoney(9500000, "TZS") -> "TZS 95,000". */
export function planPriceLabel(priceMinor: number, currency = "TZS"): string {
  return formatMoney(priceMinor, currency);
}

export interface UsageMeter {
  key: string;
  used: number;
  limit: number;
  unlimited: boolean;
}

/**
 * Pure usage summary over the four plan meters. A limit < 0 means unlimited
 * (Enterprise convention from PlanLimitsSchema).
 */
export function summarizeUsage(
  counts: { branches: number; staff: number; bookings_per_month: number; whatsapp_messages: number },
  limits: PlanLimits,
): UsageMeter[] {
  const keys = ["branches", "staff", "bookings_per_month", "whatsapp_messages"] as const;
  return keys.map((key) => {
    const limit = limits[key] ?? 0;
    return { key, used: counts[key] ?? 0, limit, unlimited: limit < 0 };
  });
}

export interface TrialRow {
  id: string;
  trial_ends_at: string | null;
}

/** Pure expiry picker for processTrialExpiries: strictly before `now`. */
export function pickExpiredTrials<T extends TrialRow>(rows: readonly T[], now: Date = new Date()): T[] {
  const at = now.getTime();
  return rows.filter((r) => {
    if (!r.trial_ends_at) return false;
    const end = new Date(r.trial_ends_at).getTime();
    return Number.isFinite(end) && end < at;
  });
}

export interface PlanChangedEventInput {
  subscriptionId: string;
  tenantId: string;
  userId: string;
  fromPlanId: string | null;
  fromPlanName: string;
  toPlanId: string;
  toPlanName: string;
}

/** Pure builder for the subscription_events row written by changePlan. */
export function buildPlanChangedEvent(input: PlanChangedEventInput): Record<string, unknown> {
  return {
    tenant_id: input.tenantId,
    subscription_id: input.subscriptionId,
    type: "plan_changed",
    amount_minor: 0,
    currency: "TZS",
    provider: null,
    provider_ref: null,
    metadata: {
      fromPlanId: input.fromPlanId,
      fromPlanName: input.fromPlanName,
      toPlanId: input.toPlanId,
      toPlanName: input.toPlanName,
    },
    user_id: input.userId,
  };
}

// ---------------------------------------------------------------------------
// Shared DB helpers
// ---------------------------------------------------------------------------

type Db = SupabaseClient;
function dbOrAdmin(db?: Db): Db {
  return db ?? getSupabaseAdmin();
}

function checkIds(tenantId: string, userId: string): void {
  const parsed = z
    .object({ tenantId: z.uuid("Invalid business."), userId: z.uuid("Invalid user. Please sign in again.") })
    .safeParse({ tenantId, userId });
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request.");
}

interface PlanRow {
  id: string;
  name: string;
  price_monthly_minor: number;
  currency: string;
  trial_days: number;
  limits: unknown;
  features: unknown;
  active: boolean;
}

interface LatestSubscription {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  plan: PlanRow | null;
}

async function latestSubscription(client: Db, tenantId: string): Promise<LatestSubscription | null> {
  const { data, error } = await client
    .from("subscriptions")
    .select("id, tenant_id, plan_id, status, trial_ends_at, current_period_end, plans ( id, name, price_monthly_minor, currency, trial_days, limits, features, active )")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as Omit<LatestSubscription, "plan"> & { plans: PlanRow | PlanRow[] | null };
  const plan = Array.isArray(row.plans) ? (row.plans[0] ?? null) : row.plans;
  return { ...row, plans: undefined, plan } as LatestSubscription;
}

function currentMonthPeriod(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

async function usageCounter(client: Db, tenantId: string, metric: string, period: string): Promise<number> {
  const { data, error } = await client
    .from("usage_counters")
    .select("count")
    .eq("tenant_id", tenantId)
    .eq("metric", metric)
    .eq("period", period)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as { count: number } | null)?.count ?? 0;
}

/** Best-effort exact head count; returns 0 when the table/query is unavailable. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeCount(client: Db, table: string, tenantId: string, extra?: (q: any) => any): Promise<number> {
  try {
    let query = client.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (extra) query = extra(query as any) as typeof query;
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// getBillingState / getTrialInfo
// ---------------------------------------------------------------------------

export interface BillingState {
  subscription: {
    id: string | null;
    status: string;
    planName: string;
    priceMinor: number;
    currency: string;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
  };
  plan: PlanRow | null;
  plans: PlanRow[];
  usage: UsageMeter[];
  events: Array<{
    id: string;
    type: string;
    amount_minor: number;
    currency: string;
    provider: string | null;
    created_at: string;
  }>;
}

export async function getBillingState(tenantId: string, userId: string, db?: Db): Promise<BillingState> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "subscription:read", db);
  const client = dbOrAdmin(db);

  try {
    const sub = await latestSubscription(client, tenantId);
    const plan = sub?.plan ?? null;
    const limits = PlanLimitsSchema.parse(plan?.limits ?? {});

    const period = currentMonthPeriod();
    const [branches, staff, bookingsCounter, whatsappCounter, branchLive, bookingLive] = await Promise.all([
      usageCounter(client, tenantId, "branches", "all_time"),
      usageCounter(client, tenantId, "staff", "all_time"),
      usageCounter(client, tenantId, "bookings_per_month", period),
      usageCounter(client, tenantId, "whatsapp_messages", period),
      safeCount(client, "branches", tenantId),
      safeCount(client, "bookings", tenantId, (q) => q.gte("created_at", `${period}-01T00:00:00.000Z`)),
    ]);

    const { data: eventsData, error: eventsError } = await client
      .from("subscription_events")
      .select("id, type, amount_minor, currency, provider, created_at")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(20);
    if (eventsError) throw eventsError;

    const { data: plansData, error: plansError } = await client
      .from("plans")
      .select("id, name, price_monthly_minor, currency, trial_days, limits, features, active")
      .eq("active", true)
      .is("deleted_at", null)
      .order("price_monthly_minor", { ascending: true });
    if (plansError) throw plansError;

    const usage = summarizeUsage(
      {
        branches: Math.max(branches, branchLive),
        staff,
        bookings_per_month: Math.max(bookingsCounter, bookingLive),
        whatsapp_messages: whatsappCounter,
      },
      limits,
    );

    return {
      subscription: {
        id: sub?.id ?? null,
        status: sub?.status ?? "trialing",
        planName: plan?.name ?? "Free Trial",
        priceMinor: plan?.price_monthly_minor ?? 0,
        currency: plan?.currency ?? "TZS",
        trialEndsAt: sub?.trial_ends_at ?? null,
        currentPeriodEnd: sub?.current_period_end ?? null,
      },
      plan,
      plans: ((plansData ?? []) as PlanRow[]),
      usage,
      events: ((eventsData ?? []) as BillingState["events"]),
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load your billing details"));
  }
}

export interface TrialInfo {
  status: string;
  daysLeft: number;
  planName: string;
}

export async function getTrialInfo(tenantId: string, userId: string, db?: Db): Promise<TrialInfo> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "subscription:read", db);
  const client = dbOrAdmin(db);
  try {
    const sub = await latestSubscription(client, tenantId);
    const status = sub?.status ?? "trialing";
    return {
      status,
      daysLeft: status === "trialing" ? trialDaysLeft(sub?.trial_ends_at ?? null) : 0,
      planName: sub?.plan?.name ?? "Free Trial",
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load your trial details"));
  }
}

// ---------------------------------------------------------------------------
// changePlan
// ---------------------------------------------------------------------------

export const ChangePlanInputSchema = z.object({
  planId: z.uuid("Invalid plan. Please choose a plan and try again."),
});
export type ChangePlanInput = z.infer<typeof ChangePlanInputSchema>;

export async function changePlan(
  tenantId: string,
  userId: string,
  rawInput: unknown,
  db?: Db,
): Promise<{ subscriptionId: string; planName: string; message: string }> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "subscription:manage", db);
  const parsed = ChangePlanInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid plan.");
  const client = dbOrAdmin(db);

  try {
    const { data: planData, error: planError } = await client
      .from("plans")
      .select("id, name, price_monthly_minor, currency, trial_days, limits, features, active")
      .eq("id", parsed.data.planId)
      .is("deleted_at", null)
      .maybeSingle();
    if (planError) throw planError;
    const plan = planData as PlanRow | null;
    if (!plan || !plan.active) {
      throw new AppError("That plan is no longer available. Please choose a different plan.");
    }

    const current = await latestSubscription(client, tenantId);
    if (current && current.plan_id === plan.id) {
      throw new AppError(`You are already on the ${plan.name} plan.`);
    }

    const nowIso = new Date().toISOString();
    if (current) {
      const { error: closeError } = await client
        .from("subscriptions")
        .update({ deleted_at: nowIso })
        .eq("id", current.id)
        .eq("tenant_id", tenantId);
      if (closeError) throw closeError;
    }

    const { data: created, error: createError } = await client
      .from("subscriptions")
      .insert({
        tenant_id: tenantId,
        plan_id: plan.id,
        status: "active",
        trial_ends_at: null,
        current_period_end: new Date(Date.now() + 30 * DAY_MS).toISOString(),
      })
      .select("id")
      .single();
    if (createError) throw createError;
    const subscriptionId = String((created as { id: string }).id);

    const { error: eventError } = await client.from("subscription_events").insert(
      buildPlanChangedEvent({
        subscriptionId,
        tenantId,
        userId,
        fromPlanId: current?.plan_id ?? null,
        fromPlanName: current?.plan?.name ?? "None",
        toPlanId: plan.id,
        toPlanName: plan.name,
      }),
    );
    if (eventError) throw eventError;

    await writeAudit(
      {
        tenantId,
        userId,
        action: "subscription.plan_changed",
        entity: "subscription",
        entityId: subscriptionId,
        metadata: { fromPlan: current?.plan?.name ?? "None", toPlan: plan.name },
      },
      { throwOnError: false },
      client,
    );

    return { subscriptionId, planName: plan.name, message: `You are now on the ${plan.name} plan.` };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not change your plan"));
  }
}

// ---------------------------------------------------------------------------
// recordSubscriptionPayment
// ---------------------------------------------------------------------------

export const RecordSubscriptionPaymentInputSchema = z.object({
  amountMinor: z.number().int("Payment amount must be a whole number of cents.").positive("Payment amount must be greater than zero."),
  provider: z.enum(["manual_mpesa", "manual_bank", "stripe"], { message: "Unknown payment method." }),
  providerRef: z.string().trim().max(64).optional(),
  periodEnd: z.string().trim().optional(),
});
export type RecordSubscriptionPaymentInput = z.infer<typeof RecordSubscriptionPaymentInputSchema>;

export async function recordSubscriptionPayment(
  tenantId: string,
  userId: string,
  rawInput: unknown,
  db?: Db,
): Promise<{ subscriptionId: string; currentPeriodEnd: string; message: string }> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "subscription:manage", db);
  const parsed = RecordSubscriptionPaymentInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check the payment and try again.");
  const input = parsed.data;
  const client = dbOrAdmin(db);

  if (input.provider === "stripe" && !process.env.STRIPE_SECRET_KEY) {
    throw new AppError("Card billing is not configured yet.");
  }

  try {
    const sub = await latestSubscription(client, tenantId);
    if (!sub) throw new AppError("No subscription found for this business. Ask support for help.");

    const base = sub.current_period_end ? new Date(sub.current_period_end).getTime() : Date.now();
    const anchor = Number.isFinite(base) && base > Date.now() ? base : Date.now();
    const explicit = input.periodEnd ? new Date(input.periodEnd).getTime() : NaN;
    const currentPeriodEnd = Number.isFinite(explicit) ? new Date(explicit).toISOString() : new Date(anchor + 30 * DAY_MS).toISOString();

    const { error: updateError } = await client
      .from("subscriptions")
      .update({ status: "active", current_period_end: currentPeriodEnd })
      .eq("id", sub.id)
      .eq("tenant_id", tenantId);
    if (updateError) throw updateError;

    const { error: eventError } = await client.from("subscription_events").insert({
      tenant_id: tenantId,
      subscription_id: sub.id,
      type: "payment_recorded",
      amount_minor: input.amountMinor,
      currency: sub.plan?.currency ?? "TZS",
      provider: input.provider,
      provider_ref: input.providerRef || null,
      metadata: { planName: sub.plan?.name ?? null },
      user_id: userId,
    });
    if (eventError) throw eventError;

    await writeAudit(
      {
        tenantId,
        userId,
        action: "subscription.payment_recorded",
        entity: "subscription",
        entityId: sub.id,
        metadata: { amountMinor: input.amountMinor, provider: input.provider },
      },
      { throwOnError: false },
      client,
    );

    return { subscriptionId: sub.id, currentPeriodEnd, message: "Payment recorded. Your subscription is active." };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not record this payment"));
  }
}

// ---------------------------------------------------------------------------
// cancelSubscription
// ---------------------------------------------------------------------------

export async function cancelSubscription(
  tenantId: string,
  userId: string,
  db?: Db,
): Promise<{ currentPeriodEnd: string | null; message: string }> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "subscription:manage", db);
  const client = dbOrAdmin(db);

  try {
    const sub = await latestSubscription(client, tenantId);
    if (!sub) throw new AppError("No subscription found for this business.");
    if (sub.status === "canceled") throw new AppError("This subscription is already canceled.");

    const { error: updateError } = await client
      .from("subscriptions")
      .update({ status: "canceled" })
      .eq("id", sub.id)
      .eq("tenant_id", tenantId);
    if (updateError) throw updateError;

    const { error: eventError } = await client.from("subscription_events").insert({
      tenant_id: tenantId,
      subscription_id: sub.id,
      type: "subscription_canceled",
      amount_minor: 0,
      currency: sub.plan?.currency ?? "TZS",
      provider: null,
      provider_ref: null,
      metadata: { planName: sub.plan?.name ?? null },
      user_id: userId,
    });
    if (eventError) throw eventError;

    await writeAudit(
      {
        tenantId,
        userId,
        action: "subscription.canceled",
        entity: "subscription",
        entityId: sub.id,
        metadata: { planName: sub.plan?.name ?? null },
      },
      { throwOnError: false },
      client,
    );

    const until = sub.current_period_end ? `You can keep working until ${sub.current_period_end.slice(0, 10)}.` : "You can keep working until the end of the current period.";
    return { currentPeriodEnd: sub.current_period_end, message: `Subscription canceled. ${until}` };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not cancel this subscription"));
  }
}

// ---------------------------------------------------------------------------
// processTrialExpiries (cron / admin button)
// ---------------------------------------------------------------------------

export async function processTrialExpiries(db?: Db): Promise<{ processed: number }> {
  const client = dbOrAdmin(db);
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await client
      .from("subscriptions")
      .select("id, tenant_id, trial_ends_at")
      .eq("status", "trialing")
      .is("deleted_at", null)
      .not("trial_ends_at", "is", null)
      .lt("trial_ends_at", nowIso)
      .limit(500);
    if (error) throw error;
    const expired = pickExpiredTrials(((data ?? []) as TrialRow[]).map((r) => ({ ...r, tenant_id: (r as unknown as { tenant_id: string }).tenant_id })), new Date());
    let processed = 0;
    for (const row of expired as Array<TrialRow & { tenant_id: string }>) {
      const { error: updateError } = await client
        .from("subscriptions")
        .update({ status: "past_due" })
        .eq("id", row.id);
      if (updateError) continue;
      await client.from("subscription_events").insert({
        tenant_id: row.tenant_id,
        subscription_id: row.id,
        type: "trial_expired",
        amount_minor: 0,
        currency: "TZS",
        provider: null,
        provider_ref: null,
        metadata: {},
        user_id: null,
      });
      processed += 1;
    }
    return { processed };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not process trial expiries"));
  }
}
