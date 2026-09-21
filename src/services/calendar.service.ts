import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, humanizeDbError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/server/supabase-admin";
import { writeAudit } from "@/services/audit.service";
import { requirePermission } from "@/services/rbac.service";

export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export const AvailabilitySlotInputSchema = z.object({
  weekday: z.number().int().min(0).max(6, "Weekday must be 0 (Sunday) to 6 (Saturday)."),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Start time must look like 08:00."),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "End time must look like 17:00."),
  active: z.boolean().optional().default(true),
});

export type AvailabilitySlotInput = z.infer<typeof AvailabilitySlotInputSchema>;

export interface AvailabilitySlot extends AvailabilitySlotInput {
  id: string;
  employeeId: string;
}

export interface DayScheduleJob {
  id: string;
  booking_id: string;
  team_id: string | null;
  status: string;
  scheduled_at: string | null;
}

export interface DayScheduleBooking {
  id: string;
  reference: string;
  status: string;
  scheduled_at: string | null;
}

export interface ScheduleConflict {
  employeeId: string;
  jobIds: string[];
}

function dbOrAdmin(db?: SupabaseClient): SupabaseClient {
  return db ?? getSupabaseAdmin();
}

function checkIds(tenantId: string, userId: string): void {
  const parsed = z
    .object({ tenantId: z.uuid("Invalid business."), userId: z.uuid("Invalid user. Please sign in again.") })
    .safeParse({ tenantId, userId });
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request.");
}

/** Pure overlap check on HH:MM ranges — used by detectConflicts helpers and tests. */
export function timeRangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Pure conflict detector: groups jobs by employee and reports employees
 * whose jobs overlap in time. Each job: { id, employeeId, start, end }.
 */
export function findScheduleConflicts(
  assignments: ReadonlyArray<{ jobId: string; employeeId: string; start: string; end: string }>,
): ScheduleConflict[] {
  const byEmployee = new Map<string, Array<{ jobId: string; start: string; end: string }>>();
  for (const a of assignments) {
    const list = byEmployee.get(a.employeeId) ?? [];
    list.push({ jobId: a.jobId, start: a.start, end: a.end });
    byEmployee.set(a.employeeId, list);
  }
  const conflicts: ScheduleConflict[] = [];
  for (const [employeeId, jobs] of byEmployee) {
    const overlapping = new Set<string>();
    for (let i = 0; i < jobs.length; i++) {
      for (let j = i + 1; j < jobs.length; j++) {
        const a = jobs[i];
        const b = jobs[j];
        if (!a || !b) continue;
        if (timeRangesOverlap(a.start, a.end, b.start, b.end)) {
          overlapping.add(a.jobId);
          overlapping.add(b.jobId);
        }
      }
    }
    if (overlapping.size > 0) conflicts.push({ employeeId, jobIds: [...overlapping] });
  }
  return conflicts;
}

export async function upsertAvailability(
  tenantId: string,
  userId: string,
  employeeId: string,
  rawSlots: unknown,
  db?: SupabaseClient,
): Promise<AvailabilitySlot[]> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "users:update", db);
  const parsed = z
    .object({ employeeId: z.uuid("Invalid employee."), slots: z.array(AvailabilitySlotInputSchema).max(21) })
    .safeParse({ employeeId, slots: rawSlots });
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check the availability and try again.");
  const client = dbOrAdmin(db);

  try {
    const { data: employee, error: empError } = await client
      .from("employees")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", employeeId)
      .is("deleted_at", null)
      .maybeSingle();
    if (empError) throw empError;
    if (!employee) throw new AppError("The selected team member could not be found in this business.");

    for (const s of parsed.data.slots) {
      if (s.startTime >= s.endTime) {
        throw new AppError("Each availability slot must end after it starts.");
      }
    }

    const { error: deleteError } = await client
      .from("availability_slots")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("employee_id", employeeId);
    if (deleteError) throw deleteError;

    if (parsed.data.slots.length === 0) return [];

    const rows = parsed.data.slots.map((s) => ({
      tenant_id: tenantId,
      employee_id: employeeId,
      weekday: s.weekday,
      start_time: s.startTime,
      end_time: s.endTime,
      active: s.active,
    }));
    const { data, error } = await client.from("availability_slots").insert(rows).select();
    if (error) throw error;

    await writeAudit(
      { tenantId, userId, action: "availability.updated", entity: "employee", entityId: employeeId, metadata: {} },
      { throwOnError: false },
      client,
    );
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      employeeId,
      weekday: Number(r.weekday ?? 0),
      startTime: String(r.start_time ?? "08:00"),
      endTime: String(r.end_time ?? "17:00"),
      active: Boolean(r.active ?? true),
    }));
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not save availability"));
  }
}

export async function getAvailability(
  tenantId: string,
  userId: string,
  employeeId: string,
  db?: SupabaseClient,
): Promise<AvailabilitySlot[]> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "users:read", db);
  const parsed = z.uuid("Invalid employee.").safeParse(employeeId);
  if (!parsed.success) throw new AppError("Invalid employee.");
  const client = dbOrAdmin(db);

  try {
    const { data, error } = await client
      .from("availability_slots")
      .select("id, employee_id, weekday, start_time, end_time, active")
      .eq("tenant_id", tenantId)
      .eq("employee_id", employeeId)
      .is("deleted_at", null)
      .order("weekday", { ascending: true });
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      employeeId: String(r.employee_id ?? employeeId),
      weekday: Number(r.weekday ?? 0),
      startTime: String(r.start_time ?? "08:00"),
      endTime: String(r.end_time ?? "17:00"),
      active: Boolean(r.active ?? true),
    }));
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load availability"));
  }
}

export async function getDaySchedule(
  tenantId: string,
  userId: string,
  rawDate: unknown,
  db?: SupabaseClient,
): Promise<{ date: string; jobs: DayScheduleJob[]; bookings: DayScheduleBooking[] }> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "bookings:read", db);
  const parsed = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must look like 2026-01-15.").safeParse(rawDate);
  if (!parsed.success) throw new AppError("Enter a valid date.");
  const date = parsed.data;
  const client = dbOrAdmin(db);

  try {
    const start = `${date}T00:00:00`;
    const end = `${date}T23:59:59.999`;
    const [{ data: jobs, error: jobsError }, { data: bookings, error: bookingsError }] = await Promise.all([
      client
        .from("jobs")
        .select("id, booking_id, team_id, status, scheduled_at")
        .eq("tenant_id", tenantId)
        .gte("scheduled_at", start)
        .lte("scheduled_at", end)
        .is("deleted_at", null)
        .order("scheduled_at", { ascending: true }),
      client
        .from("bookings")
        .select("id, reference, status, scheduled_at")
        .eq("tenant_id", tenantId)
        .gte("scheduled_at", start)
        .lte("scheduled_at", end)
        .is("deleted_at", null)
        .order("scheduled_at", { ascending: true }),
    ]);
    if (jobsError) throw jobsError;
    if (bookingsError) throw bookingsError;
    return {
      date,
      jobs: ((jobs ?? []) as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        booking_id: String(r.booking_id ?? ""),
        team_id: (r.team_id as string | null) ?? null,
        status: String(r.status ?? ""),
        scheduled_at: (r.scheduled_at as string | null) ?? null,
      })),
      bookings: ((bookings ?? []) as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        reference: String(r.reference ?? ""),
        status: String(r.status ?? ""),
        scheduled_at: (r.scheduled_at as string | null) ?? null,
      })),
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load the schedule"));
  }
}

/**
 * Detects same-employee overlapping jobs on a date: loads that day's jobs
 * plus their staff assignments and reports conflicts as {employeeId, jobIds}.
 */
export async function detectConflicts(
  tenantId: string,
  userId: string,
  rawDate: unknown,
  db?: SupabaseClient,
): Promise<ScheduleConflict[]> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "bookings:read", db);
  const parsed = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must look like 2026-01-15.").safeParse(rawDate);
  if (!parsed.success) throw new AppError("Enter a valid date.");
  const client = dbOrAdmin(db);

  try {
    const schedule = await getDaySchedule(tenantId, userId, parsed.data, client);
    if (schedule.jobs.length === 0) return [];
    const jobIds = schedule.jobs.map((j) => j.id);
    const { data: assignments, error } = await client
      .from("job_assignments")
      .select("job_id, employee_id")
      .eq("tenant_id", tenantId)
      .in("job_id", jobIds)
      .is("deleted_at", null);
    if (error) throw error;

    const byJob = new Map(schedule.jobs.map((j) => [j.id, j]));
    const rows = ((assignments ?? []) as Array<{ job_id: string; employee_id: string }>).map((a) => {
      const job = byJob.get(a.job_id);
      const start = job?.scheduled_at ?? "";
      // Default 2-hour window when only a start time is known.
      const end = start ? new Date(new Date(start).getTime() + 2 * 3_600_000).toISOString() : "";
      return { jobId: a.job_id, employeeId: a.employee_id, start, end };
    }).filter((r) => r.start && r.end);
    return findScheduleConflicts(rows);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not check for conflicts"));
  }
}
