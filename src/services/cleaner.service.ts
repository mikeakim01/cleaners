import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, humanizeDbError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/server/supabase-admin";
import { requirePermission } from "@/services/rbac.service";
import type { JobStatus } from "@/services/jobs.service";
import type { Employee } from "@/services/employees.service";

/**
 * Cleaner (field-staff) read model.
 *
 * NOTE on status transitions: this module deliberately does NOT wrap
 * jobs.service updateJobStatus. Status moves (startRoute / arrive /
 * startCleaning / complete) go through the existing updateJobStatusAction,
 * which already enforces the transition map plus assigned-cleaner ownership
 * (assertJobAssignee). Wrapping it here would duplicate that logic.
 */

export interface MyJobBooking {
  reference: string;
  customerName: string;
  customerPhone: string | null;
  address: string | null;
  ward: string | null;
  serviceName: string | null;
  scheduledAt: string | null;
  amountMinor: number;
  currency: string;
}

export interface MyJob {
  job: { id: string; status: JobStatus; scheduled_at: string | null };
  booking: MyJobBooking;
  teamName: string | null;
  photos: { before: number; after: number };
}

export interface ScheduleBucket {
  date: string;
  jobs: MyJob[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dbOrAdmin(db?: SupabaseClient): SupabaseClient {
  return db ?? getSupabaseAdmin();
}

function checkIds(tenantId: string, userId: string): void {
  const parsed = z
    .object({ tenantId: z.uuid("Invalid business."), userId: z.uuid("Invalid user. Please sign in again.") })
    .safeParse({ tenantId, userId });
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request.");
}

/** Pure: 7 day keys (YYYY-MM-DD) starting at weekStartISO, UTC. */
export function weekDayKeys(weekStartISO: string): string[] {
  if (!DATE_RE.test(weekStartISO)) throw new AppError("Invalid week. Please pick a valid date.");
  const start = new Date(`${weekStartISO}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) throw new AppError("Invalid week. Please pick a valid date.");
  const keys: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}

/** Pure: day key (YYYY-MM-DD, UTC) for a timestamptz value, null when absent. */
export function dayKeyForTimestamp(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Pure: bucket jobs into the 7 day keys of a week. Jobs outside the week are dropped. */
export function groupMyJobsByWeek(jobs: MyJob[], weekStartISO: string): ScheduleBucket[] {
  const keys = weekDayKeys(weekStartISO);
  const buckets: ScheduleBucket[] = keys.map((date) => ({ date, jobs: [] }));
  const byDate = new Map(buckets.map((b) => [b.date, b]));
  for (const job of jobs) {
    const key = dayKeyForTimestamp(job.job.scheduled_at);
    const bucket = key ? byDate.get(key) : undefined;
    if (bucket) bucket.jobs.push(job);
  }
  return buckets;
}

/** Field-staff employee record for the signed-in user (respects linkUser binding). */
export async function resolveMyEmployee(
  tenantId: string,
  userId: string,
  db?: SupabaseClient,
): Promise<Employee> {
  checkIds(tenantId, userId);
  const client = dbOrAdmin(db);
  try {
    const { data, error } = await client
      .from("employees")
      .select("id, tenant_id, branch_id, user_id, full_name, phone_e164, role, active")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new AppError("Your staff profile is not linked yet. Ask your manager to link your login.");
    }
    return data as Employee;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load your staff profile"));
  }
}

function photoCounts(rows: Array<{ storage_path: string }>): { before: number; after: number } {
  let before = 0;
  let after = 0;
  for (const row of rows) {
    const filename = row.storage_path.split("/").pop() ?? "";
    if (filename.startsWith("before-")) before += 1;
    else if (filename.startsWith("after-")) after += 1;
  }
  return { before, after };
}

async function enrichJobs(
  client: SupabaseClient,
  tenantId: string,
  jobRows: Array<Record<string, unknown>>,
): Promise<MyJob[]> {
  if (jobRows.length === 0) return [];

  const jobIds = jobRows.map((r) => String(r.id));
  const bookingIds = [...new Set(jobRows.map((r) => String(r.booking_id)))];

  const { data: bookingsData, error: bookingsError } = await client
    .from("bookings")
    .select("id, reference, customer_id, service_id, address, ward, scheduled_at, amount_minor, currency")
    .eq("tenant_id", tenantId)
    .in("id", bookingIds)
    .is("deleted_at", null);
  if (bookingsError) throw bookingsError;
  const bookings = (bookingsData ?? []) as Array<Record<string, unknown>>;
  const bookingById = new Map(bookings.map((b) => [String(b.id), b]));

  const customerIds = [...new Set(bookings.map((b) => String(b.customer_id)).filter(Boolean))];
  const serviceIds = [...new Set(bookings.map((b) => b.service_id as string | null).filter(Boolean))];
  const teamIds = [...new Set(jobRows.map((r) => r.team_id as string | null).filter(Boolean))];

  const { data: customersData, error: customersError } = customerIds.length
    ? await client
        .from("customers")
        .select("id, full_name, phone_e164, address, ward")
        .eq("tenant_id", tenantId)
        .in("id", customerIds)
        .is("deleted_at", null)
    : { data: [], error: null };
  if (customersError) throw customersError;
  const customerById = new Map(
    ((customersData ?? []) as Array<Record<string, unknown>>).map((c) => [String(c.id), c]),
  );

  const { data: servicesData, error: servicesError } = serviceIds.length
    ? await client
        .from("services")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .in("id", serviceIds as string[])
        .is("deleted_at", null)
    : { data: [], error: null };
  if (servicesError) throw servicesError;
  const serviceById = new Map(
    ((servicesData ?? []) as Array<Record<string, unknown>>).map((s) => [String(s.id), s]),
  );

  const { data: teamsData, error: teamsError } = teamIds.length
    ? await client
        .from("teams")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .in("id", teamIds as string[])
        .is("deleted_at", null)
    : { data: [], error: null };
  if (teamsError) throw teamsError;
  const teamById = new Map(
    ((teamsData ?? []) as Array<Record<string, unknown>>).map((t) => [String(t.id), t]),
  );

  const { data: filesData, error: filesError } = await client
    .from("files")
    .select("entity_id, storage_path")
    .eq("tenant_id", tenantId)
    .eq("entity", "job")
    .eq("kind", "photo")
    .in("entity_id", jobIds)
    .is("deleted_at", null);
  if (filesError) throw filesError;
  const filesByJob = new Map<string, Array<{ storage_path: string }>>();
  for (const f of ((filesData ?? []) as Array<{ entity_id: string; storage_path: string }>)) {
    const list = filesByJob.get(f.entity_id) ?? [];
    list.push({ storage_path: f.storage_path });
    filesByJob.set(f.entity_id, list);
  }

  return jobRows.map((row) => {
    const jobId = String(row.id);
    const booking = bookingById.get(String(row.booking_id));
    const customer = booking ? customerById.get(String(booking.customer_id)) : undefined;
    const service = booking?.service_id ? serviceById.get(String(booking.service_id)) : undefined;
    const team = row.team_id ? teamById.get(String(row.team_id)) : undefined;
    const scheduledAt = (row.scheduled_at as string | null) ?? (booking?.scheduled_at as string | null) ?? null;
    return {
      job: {
        id: jobId,
        status: row.status as JobStatus,
        scheduled_at: (row.scheduled_at as string | null) ?? null,
      },
      booking: {
        reference: booking ? String(booking.reference ?? "") : "",
        customerName: customer ? String(customer.full_name ?? "") : "",
        customerPhone: (customer?.phone_e164 as string | null) ?? null,
        address: (booking?.address as string | null) ?? (customer?.address as string | null) ?? null,
        ward: (booking?.ward as string | null) ?? (customer?.ward as string | null) ?? null,
        serviceName: service ? String(service.name ?? "") : null,
        scheduledAt,
        amountMinor: Number(booking?.amount_minor ?? 0),
        currency: String(booking?.currency ?? "TZS"),
      },
      teamName: team ? String(team.name ?? "") : null,
      photos: photoCounts(filesByJob.get(jobId) ?? []),
    };
  });
}

/** Jobs assigned to the signed-in cleaner, optionally filtered to one day (YYYY-MM-DD). */
export async function getMyJobs(
  tenantId: string,
  userId: string,
  rawFilter: unknown = {},
  db?: SupabaseClient,
): Promise<MyJob[]> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "bookings:read", db);
  const parsed = z
    .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date. Please pick a valid day.").optional() })
    .safeParse(rawFilter ?? {});
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid filter.");
  const client = dbOrAdmin(db);

  try {
    const me = await resolveMyEmployee(tenantId, userId, client);
    const { data: assignments, error: assignError } = await client
      .from("job_assignments")
      .select("job_id")
      .eq("tenant_id", tenantId)
      .eq("employee_id", me.id)
      .is("deleted_at", null);
    if (assignError) throw assignError;
    const jobIds = ((assignments ?? []) as Array<{ job_id: string }>).map((a) => a.job_id);
    if (jobIds.length === 0) return [];

    let query = client
      .from("jobs")
      .select("id, booking_id, team_id, status, scheduled_at")
      .eq("tenant_id", tenantId)
      .in("id", jobIds)
      .is("deleted_at", null)
      .order("scheduled_at", { ascending: true })
      .limit(200);
    if (parsed.data.date) {
      const day = parsed.data.date;
      query = query.gte("scheduled_at", `${day}T00:00:00.000Z`).lt("scheduled_at", `${nextDay(day)}T00:00:00.000Z`);
    }
    const { data: jobs, error: jobsError } = await query;
    if (jobsError) throw jobsError;
    return enrichJobs(client, tenantId, ((jobs ?? []) as Array<Record<string, unknown>>));
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load your jobs"));
  }
}

function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  return new Date(d.getTime() + 86_400_000).toISOString().slice(0, 10);
}

/** 7-day buckets of the signed-in cleaner's jobs starting at weekStartISO (YYYY-MM-DD). */
export async function listMySchedule(
  tenantId: string,
  userId: string,
  weekStartISO: string,
  db?: SupabaseClient,
): Promise<ScheduleBucket[]> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "bookings:read", db);
  const keys = weekDayKeys(weekStartISO);
  const client = dbOrAdmin(db);

  try {
    const mine = await getMyJobs(tenantId, userId, {}, client);
    const inWeek = mine.filter((j) => {
      const key = dayKeyForTimestamp(j.job.scheduled_at);
      return key !== null && keys.includes(key);
    });
    return groupMyJobsByWeek(inWeek, weekStartISO);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load your schedule"));
  }
}
