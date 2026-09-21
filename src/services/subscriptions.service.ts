import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, humanizeDbError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/server/supabase-admin";

// Limits mirror the plan catalogue seed (plans.limits jsonb).
// Enterprise uses -1 for unlimited.
export const PlanLimitsSchema = z.object({
  branches: z.number().int().optional().default(3),
  staff: z.number().int().optional().default(10),
  bookings_per_month: z.number().int().optional().default(200),
  whatsapp_messages: z.number().int().optional().default(500),
});
export type PlanLimits = z.infer<typeof PlanLimitsSchema>;

export interface Subscription {
  tenant_id: string;
  plan_id: string;
  status: string;
  plan_name: string;
  limits: PlanLimits;
}

export type LimitResource = "branches" | "staff" | "bookingsPerMonth" | "whatsappMessages";

const RESOURCE_METRIC: Record<LimitResource, string> = {
  branches: "branches",
  staff: "staff",
  bookingsPerMonth: "bookings_per_month",
  whatsappMessages: "whatsapp_messages",
};

const RESOURCE_LABEL: Record<LimitResource, string> = {
  branches: "branches",
  staff: "team members",
  bookingsPerMonth: "bookings this month",
  whatsappMessages: "WhatsApp messages",
};

function dbOrAdmin(db?: SupabaseClient): SupabaseClient {
  return db ?? getSupabaseAdmin();
}

function currentPeriod(resource: LimitResource): string {
  if (resource === "bookingsPerMonth" || resource === "whatsappMessages") {
    return new Date().toISOString().slice(0, 7); // YYYY-MM
  }
  return "all_time";
}

export async function getSubscription(tenantId: string, db?: SupabaseClient): Promise<Subscription> {
  const parsed = z.string().uuid("Invalid business.").safeParse(tenantId);
  if (!parsed.success) throw new AppError("Invalid business.");
  const client = dbOrAdmin(db);
  try {
    const { data, error } = await client
      .from("subscriptions")
      .select("tenant_id, plan_id, status, plans ( name, limits )")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return {
        tenant_id: tenantId,
        plan_id: "trial",
        status: "trialing",
        plan_name: "Free Trial",
        limits: PlanLimitsSchema.parse({}),
      };
    }
    const row = data as unknown as {
      tenant_id: string;
      plan_id: string;
      status: string;
      plans: { name: string; limits: unknown } | { name: string; limits: unknown }[] | null;
    };
    const plan = Array.isArray(row.plans) ? row.plans[0] : row.plans;
    return {
      tenant_id: row.tenant_id,
      plan_id: row.plan_id,
      status: row.status,
      plan_name: plan?.name ?? "Free Trial",
      limits: PlanLimitsSchema.parse(plan?.limits ?? {}),
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load your subscription"));
  }
}

async function currentUsage(
  client: SupabaseClient,
  tenantId: string,
  resource: LimitResource,
): Promise<number> {
  const { data, error } = await client
    .from("usage_counters")
    .select("count")
    .eq("tenant_id", tenantId)
    .eq("metric", RESOURCE_METRIC[resource])
    .eq("period", currentPeriod(resource))
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as { count: number } | null)?.count ?? 0;
}

/** Throws a human-readable AppError when the tenant is over its plan limit. */
export async function assertWithinLimits(
  tenantId: string,
  resource: LimitResource,
  db?: SupabaseClient,
): Promise<{ limit: number; used: number }> {
  const client = dbOrAdmin(db);
  const sub = await getSubscription(tenantId, client);
  const key = resource === "bookingsPerMonth" ? "bookings_per_month" : resource === "whatsappMessages" ? "whatsapp_messages" : resource;
  const limit = sub.limits[key as keyof PlanLimits];
  try {
    if (limit < 0) return { limit, used: await currentUsage(client, tenantId, resource) };
    const used = await currentUsage(client, tenantId, resource);
    if (used >= limit) {
      throw new AppError(
        `You have used all ${limit} ${RESOURCE_LABEL[resource]} on the ${sub.plan_name} plan. Upgrade to add more.`,
      );
    }
    return { limit, used };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not check your plan usage"));
  }
}
