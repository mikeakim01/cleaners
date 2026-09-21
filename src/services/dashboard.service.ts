import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, humanizeDbError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/server/supabase-admin";

export interface DashboardKpis {
  todayBookings: number;
  upcomingJobs: number;
  revenueThisMonth: number;
  pendingPayments: number;
  completedJobs: number;
  newCustomers: number;
}

export interface RevenuePoint {
  day: string;
  revenue: number;
}

export interface RecentBooking {
  id: string;
  customer: string;
  service: string;
  date: string;
  status: string;
}

// Phase 2 domain tables (bookings, jobs, customers, …) do not exist yet.
// Every query is failure-safe so the dashboard renders empty states instead
// of errors until Phase 2 seeds land.

async function safeCount(
  client: SupabaseClient,
  table: string,
  match: Record<string, unknown>,
): Promise<number> {
  try {
    let query = client.from(table).select("id", { count: "exact", head: true });
    for (const [k, v] of Object.entries(match)) query = query.eq(k, v as string);
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export async function getDashboardKpis(tenantId: string, db?: SupabaseClient): Promise<DashboardKpis> {
  if (!tenantId) throw new AppError("Invalid business.");
  const client = db ?? getSupabaseAdmin();
  try {
    const [todayBookings, upcomingJobs, completedJobs, newCustomers, pendingPayments] =
      await Promise.all([
        safeCount(client, "bookings", { tenant_id: tenantId }),
        safeCount(client, "jobs", { tenant_id: tenantId }),
        safeCount(client, "jobs", { tenant_id: tenantId }),
        safeCount(client, "customers", { tenant_id: tenantId }),
        safeCount(client, "invoices", { tenant_id: tenantId }),
      ]);

    let revenueThisMonth = 0;
    try {
      const { data, error } = await client
        .from("payments")
        .select("amount_minor")
        .eq("tenant_id", tenantId);
      if (error) throw error;
      revenueThisMonth =
        ((data as { amount_minor: number }[] | null) ?? []).reduce(
          (sum, p) => sum + (Number(p.amount_minor) || 0),
          0,
        ) / 100;
    } catch {
      revenueThisMonth = 0;
    }

    return { todayBookings, upcomingJobs, revenueThisMonth, pendingPayments, completedJobs, newCustomers };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load dashboard figures"));
  }
}

export async function getRevenueTrend(tenantId: string, db?: SupabaseClient): Promise<RevenuePoint[]> {
  const client = db ?? getSupabaseAdmin();
  try {
    const { data, error } = await client
      .from("payments")
      .select("amount_minor, paid_at")
      .eq("tenant_id", tenantId)
      .order("paid_at", { ascending: true })
      .limit(60);
    if (error) throw error;
    const rows = (data as { amount_minor: number; paid_at: string }[] | null) ?? [];
    if (rows.length === 0) return [];
    const byDay = new Map<string, number>();
    for (const r of rows) {
      const day = (r.paid_at ?? "").slice(0, 10) || "—";
      byDay.set(day, (byDay.get(day) ?? 0) + (Number(r.amount_minor) || 0) / 100);
    }
    return [...byDay.entries()].map(([day, revenue]) => ({ day, revenue }));
  } catch {
    return [];
  }
}

export async function getRecentBookings(tenantId: string, db?: SupabaseClient): Promise<RecentBooking[]> {
  const client = db ?? getSupabaseAdmin();
  try {
    const { data, error } = await client
      .from("bookings")
      .select("id, status, scheduled_at, customers ( name ), services ( name )")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(8);
    if (error) throw error;
    return ((data as unknown[]) ?? []).map((b) => {
      const row = b as {
        id: string;
        status: string;
        scheduled_at: string;
        customers: { name: string } | { name: string }[] | null;
        services: { name: string } | { name: string }[] | null;
      };
      const cust = Array.isArray(row.customers) ? row.customers[0] : row.customers;
      const svc = Array.isArray(row.services) ? row.services[0] : row.services;
      return {
        id: row.id,
        customer: cust?.name ?? "—",
        service: svc?.name ?? "—",
        date: row.scheduled_at ?? "—",
        status: row.status ?? "pending",
      };
    });
  } catch {
    return [];
  }
}

export async function getWhatsappEnquiries(tenantId: string, db?: SupabaseClient): Promise<number> {
  const client = db ?? getSupabaseAdmin();
  return safeCount(client, "whatsapp_messages", { tenant_id: tenantId });
}
