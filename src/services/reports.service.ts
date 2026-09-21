import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, humanizeDbError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/server/supabase-admin";
import { requirePermission } from "@/services/rbac.service";

export interface DayBucket {
  date: string;
  collectedMinor: number;
}

export interface StatusBucket {
  status: string;
  count: number;
  totalMinor: number;
}

export interface BranchBucket {
  branchId: string;
  branchName: string | null;
  totalMinor: number;
  count: number;
}

export interface FinancialSummary {
  revenueMinor: number;
  collectedMinor: number;
  outstandingMinor: number;
  overdueMinor: number;
  byDay: DayBucket[];
  byStatus: StatusBucket[];
  byBranch: BranchBucket[];
}

export const FinancialSummaryFilterSchema = z.object({
  from: z.string().trim().optional().default(""),
  to: z.string().trim().optional().default(""),
});

export type FinancialSummaryFilter = z.infer<typeof FinancialSummaryFilterSchema>;

function dbOrAdmin(db?: SupabaseClient): SupabaseClient {
  return db ?? getSupabaseAdmin();
}

function checkIds(tenantId: string, userId: string): void {
  const parsed = z
    .object({ tenantId: z.uuid("Invalid business."), userId: z.uuid("Invalid user. Please sign in again.") })
    .safeParse({ tenantId, userId });
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request.");
}

/** Pure: YYYY-MM-DD key for a timestamp (UTC date part). */
export function toDayKey(receivedAt: string): string {
  return String(receivedAt ?? "").slice(0, 10);
}

/** Pure: bucket CONFIRMED payments by received_at day, ordered ascending. */
export function bucketPaymentsByDay(
  payments: ReadonlyArray<{ received_at: string; amount_minor: number; status: string }>,
): DayBucket[] {
  const byDay = new Map<string, number>();
  for (const p of payments) {
    if (p.status !== "CONFIRMED") continue;
    const day = toDayKey(p.received_at);
    if (!day) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + p.amount_minor);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, collectedMinor]) => ({ date, collectedMinor }));
}

/** Pure: count + total per invoice status. */
export function summarizeByStatus(
  invoices: ReadonlyArray<{ status: string; total_minor: number }>,
): StatusBucket[] {
  const byStatus = new Map<string, { count: number; totalMinor: number }>();
  for (const inv of invoices) {
    const entry = byStatus.get(inv.status) ?? { count: 0, totalMinor: 0 };
    entry.count += 1;
    entry.totalMinor += inv.total_minor;
    byStatus.set(inv.status, entry);
  }
  return [...byStatus.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([status, v]) => ({ status, count: v.count, totalMinor: v.totalMinor }));
}

const OUTSTANDING_STATUSES = ["SENT", "PARTIAL", "OVERDUE"] as const;

/** Pure: sum(total - amount_paid) over SENT|PARTIAL|OVERDUE invoices. */
export function sumOutstanding(
  invoices: ReadonlyArray<{ status: string; total_minor: number; amount_paid_minor: number }>,
): number {
  return invoices
    .filter((i) => (OUTSTANDING_STATUSES as readonly string[]).includes(i.status))
    .reduce((sum, i) => sum + Math.max(0, i.total_minor - i.amount_paid_minor), 0);
}

/** Pure: sum(total - amount_paid) over OVERDUE invoices only. */
export function sumOverdue(
  invoices: ReadonlyArray<{ status: string; total_minor: number; amount_paid_minor: number }>,
): number {
  return invoices
    .filter((i) => i.status === "OVERDUE")
    .reduce((sum, i) => sum + Math.max(0, i.total_minor - i.amount_paid_minor), 0);
}

/** Pure: sum of CONFIRMED payment amounts. */
export function sumCollected(
  payments: ReadonlyArray<{ status: string; amount_minor: number }>,
): number {
  return payments
    .filter((p) => p.status === "CONFIRMED")
    .reduce((sum, p) => sum + p.amount_minor, 0);
}

export async function getFinancialSummary(
  tenantId: string,
  userId: string,
  rawFilter: unknown = {},
  db?: SupabaseClient,
): Promise<FinancialSummary> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "reports:read", db);
  const parsed = FinancialSummaryFilterSchema.safeParse(rawFilter ?? {});
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid filter.");
  const f = parsed.data;
  const client = dbOrAdmin(db);

  try {
    let paymentQuery = client
      .from("payments")
      .select("amount_minor, status, received_at")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null);
    if (f.from) paymentQuery = paymentQuery.gte("received_at", f.from);
    if (f.to) paymentQuery = paymentQuery.lte("received_at", f.to);

    const [paymentsRes, invoicesRes, bookingsRes, branchesRes] = await Promise.all([
      paymentQuery.order("received_at", { ascending: true }).limit(2000),
      client
        .from("invoices")
        .select("id, booking_id, status, total_minor, amount_paid_minor")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .limit(2000),
      client
        .from("bookings")
        .select("id, branch_id")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .limit(2000),
      client
        .from("branches")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .limit(100),
    ]);
    if (paymentsRes.error) throw paymentsRes.error;
    if (invoicesRes.error) throw invoicesRes.error;
    if (bookingsRes.error) throw bookingsRes.error;
    if (branchesRes.error) throw branchesRes.error;

    const payments = ((paymentsRes.data ?? []) as Array<{ amount_minor: number; status: string; received_at: string }>);
    const invoices = ((invoicesRes.data ?? []) as Array<{
      id: string;
      booking_id: string | null;
      status: string;
      total_minor: number;
      amount_paid_minor: number;
    }>);

    const revenueMinor = sumCollected(payments);
    const outstandingMinor = sumOutstanding(invoices);
    const overdueMinor = sumOverdue(invoices);

    const byDay = bucketPaymentsByDay(payments);
    const byStatus = summarizeByStatus(invoices);

    // Branch attribution via the booking link; invoices without a booking are skipped.
    const branchByBooking = new Map<string, string>();
    for (const b of ((bookingsRes.data ?? []) as Array<{ id: string; branch_id: string | null }>)) {
      if (b.branch_id) branchByBooking.set(String(b.id), String(b.branch_id));
    }
    const branchTotals = new Map<string, { total: number; count: number }>();
    for (const inv of invoices) {
      if (!inv.booking_id) continue;
      const branchId = branchByBooking.get(String(inv.booking_id));
      if (!branchId) continue;
      const entry = branchTotals.get(branchId) ?? { total: 0, count: 0 };
      entry.total += Number(inv.total_minor ?? 0);
      entry.count += 1;
      branchTotals.set(branchId, entry);
    }
    const branchNames = new Map<string, string>();
    for (const b of ((branchesRes.data ?? []) as Array<{ id: string; name: string }>)) {
      branchNames.set(String(b.id), String(b.name ?? ""));
    }
    const byBranch: BranchBucket[] = [...branchTotals.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([branchId, v]) => ({
        branchId,
        branchName: branchNames.get(branchId) ?? null,
        totalMinor: v.total,
        count: v.count,
      }));

    return {
      revenueMinor,
      collectedMinor: revenueMinor,
      outstandingMinor,
      overdueMinor,
      byDay,
      byStatus,
      byBranch,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load the financial summary"));
  }
}
