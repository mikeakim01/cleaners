/**
 * Service-to-display mappers for billing + platform admin (Phase 6).
 * Services speak mixed snake_case; UI speaks camelCase. All mapping lives
 * here — never in components. Type-only service imports (erased at build),
 * so this module is safe for client components.
 */
import type { BillingState } from "@/services/billing.service";
import type {
  AdminTenantRow as ServiceTenantRow,
  Plan as ServicePlan,
  PlatformAuditRow as ServiceAuditRow,
  PlatformStats as ServiceStats,
  TenantDetail as ServiceTenantDetail,
} from "@/services/admin.service";

export interface BillingSubscription {
  status: string;
  planName: string;
  priceMinor: number;
  currency: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
}

export interface BillingUsageEntry {
  key: string;
  used: number;
  limit: number;
}

export interface BillingEventEntry {
  type: string;
  amountMinor: number;
  createdAt: string;
}

export interface BillingPlanOption {
  id: string;
  name: string;
  priceMinor: number;
  currency: string;
  trialDays: number;
  features: string[];
}

export interface BillingStateData {
  subscription: BillingSubscription;
  usage: BillingUsageEntry[];
  events: BillingEventEntry[];
  plans: BillingPlanOption[];
}

export interface TrialInfo {
  status: string;
  daysLeft: number;
  planName: string;
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
  planDistribution: { planName: string; count: number }[];
}

export interface AdminTenantRow {
  id: string;
  slug: string;
  name: string;
  planName: string;
  subscriptionStatus: string;
  suspended: boolean;
  users: number;
  bookingsVolume: number;
  trialEndsAt: string | null;
}

export interface TenantDetailData {
  tenant: { id: string; slug: string; name: string; suspended: boolean };
  subscription: BillingSubscription;
  usage: BillingUsageEntry[];
  counts: { users: number; bookings: number; invoices: number };
  members: { id: string; name: string; email: string; role: string }[];
}

export interface PlatformPlan {
  id: string;
  name: string;
  priceMinor: number;
  currency: string;
  trialDays: number;
  limits: Record<string, number>;
  active: boolean;
}

export interface PlanInput {
  name: string;
  priceMinor: number;
  currency: string;
  trialDays: number;
  limits: Record<string, number>;
  active: boolean;
}

export interface PlatformAuditRow {
  action: string;
  actorUserId: string | null;
  tenantId: string | null;
  createdAt: string;
}

function toFeatures(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((f): f is string => typeof f === "string")
    : [];
}

function toLimits(raw: unknown): Record<string, number> {
  if (typeof raw !== "object" || raw === null) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

export function mapBillingState(s: BillingState): BillingStateData {
  return {
    subscription: {
      status: s.subscription.status,
      planName: s.subscription.planName,
      priceMinor: s.subscription.priceMinor,
      currency: s.subscription.currency,
      trialEndsAt: s.subscription.trialEndsAt,
      currentPeriodEnd: s.subscription.currentPeriodEnd,
    },
    usage: s.usage.map((u) => ({ key: u.key, used: u.used, limit: u.limit })),
    events: s.events.map((e) => ({
      type: e.type,
      amountMinor: e.amount_minor,
      createdAt: e.created_at,
    })),
    plans: s.plans.map((p) => ({
      id: p.id,
      name: p.name,
      priceMinor: p.price_monthly_minor,
      currency: p.currency,
      trialDays: p.trial_days,
      features: toFeatures(p.features),
    })),
  };
}

export function mapPlatformStats(s: ServiceStats): PlatformStats {
  return { ...s };
}

export function mapTenantRows(rows: ServiceTenantRow[]): AdminTenantRow[] {
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    planName: r.planName ?? "",
    subscriptionStatus: r.subscriptionStatus ?? "",
    suspended: r.suspended,
    users: r.users,
    bookingsVolume: r.bookingsVolume,
    trialEndsAt: r.trialEndsAt,
  }));
}

export function mapTenantDetail(d: ServiceTenantDetail): TenantDetailData {
  return {
    tenant: {
      id: d.tenant.id,
      slug: d.tenant.slug,
      name: d.tenant.name,
      suspended: d.tenant.suspended,
    },
    subscription: d.subscription
      ? {
          status: d.subscription.status,
          planName: d.subscription.planName,
          priceMinor: d.subscription.priceMinor,
          currency: d.subscription.currency,
          trialEndsAt: d.subscription.trialEndsAt,
          currentPeriodEnd: d.subscription.currentPeriodEnd,
        }
      : {
          status: "trialing",
          planName: "Free Trial",
          priceMinor: 0,
          currency: "TZS",
          trialEndsAt: null,
          currentPeriodEnd: null,
        },
    usage: d.usage.map((u) => ({ key: u.key, used: u.used, limit: u.limit })),
    counts: {
      users: d.members.length,
      bookings: d.counts.bookings,
      invoices: d.counts.invoices,
    },
    members: d.members.map((m) => ({
      id: m.userId,
      name: m.name ?? m.userId.slice(0, 8),
      email: m.email ?? "",
      role: m.role,
    })),
  };
}

export function mapPlans(plans: ServicePlan[]): PlatformPlan[] {
  return plans.map((p) => ({
    id: p.id,
    name: p.name,
    priceMinor: p.price_monthly_minor,
    currency: p.currency,
    trialDays: p.trial_days,
    limits: toLimits(p.limits),
    active: p.active,
  }));
}

export function mapAuditRows(rows: ServiceAuditRow[]): PlatformAuditRow[] {
  return rows.map((r) => ({
    action: r.action,
    actorUserId: r.actor_user_id,
    tenantId: r.tenant_id,
    createdAt: r.created_at,
  }));
}
