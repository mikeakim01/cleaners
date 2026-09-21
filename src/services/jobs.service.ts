import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, humanizeDbError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/server/supabase-admin";
import { writeAudit } from "@/services/audit.service";
import { requirePermission } from "@/services/rbac.service";

export const JOB_STATUSES = [
  "SCHEDULED",
  "ASSIGNED",
  "EN_ROUTE",
  "ARRIVED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

/** Pure transition map — importable for unit tests and UI gating. */
export const JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  SCHEDULED: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["EN_ROUTE", "CANCELLED"],
  EN_ROUTE: ["ARRIVED"],
  ARRIVED: ["IN_PROGRESS"],
  IN_PROGRESS: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertJobTransitionAllowed(from: JobStatus, to: JobStatus): void {
  if (!canTransitionJob(from, to)) {
    throw new AppError(`Cannot move job from ${from} to ${to}.`);
  }
}

/**
 * Pure ownership check: field staff (CLEANER/DRIVER) may only update jobs
 * they are assigned to. Throws the human message when blocked.
 */
export function assertJobAssignee(
  role: string,
  callerEmployeeId: string | null,
  assignedEmployeeIds: readonly string[],
): void {
  if (role !== "CLEANER" && role !== "DRIVER") return;
  if (!callerEmployeeId || !assignedEmployeeIds.includes(callerEmployeeId)) {
    throw new AppError("You are not assigned to this job.");
  }
}

export const CreateJobInputSchema = z.object({
  teamId: z.uuid("Invalid team.").optional(),
  scheduledAt: z.string().trim().min(1, "Scheduled date is required.").optional(),
  notes: z.string().trim().max(1000).optional().default(""),
});

export interface Job {
  id: string;
  tenant_id: string;
  booking_id: string;
  team_id: string | null;
  status: JobStatus;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
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

function toJob(row: Record<string, unknown>): Job {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    booking_id: String(row.booking_id ?? ""),
    team_id: (row.team_id as string | null) ?? null,
    status: row.status as JobStatus,
    scheduled_at: (row.scheduled_at as string | null) ?? null,
    started_at: (row.started_at as string | null) ?? null,
    completed_at: (row.completed_at as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
  };
}

async function callerEmployeeId(client: SupabaseClient, tenantId: string, userId: string): Promise<string | null> {
  const { data } = await client
    .from("employees")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  return ((data as { id?: unknown } | null)?.id as string) ?? null;
}

async function assignedEmployeeIds(client: SupabaseClient, tenantId: string, jobId: string): Promise<string[]> {
  const { data } = await client
    .from("job_assignments")
    .select("employee_id")
    .eq("tenant_id", tenantId)
    .eq("job_id", jobId)
    .is("deleted_at", null);
  return ((data ?? []) as Array<{ employee_id: string }>).map((r) => r.employee_id);
}

export async function createJobFromBooking(
  tenantId: string,
  userId: string,
  bookingId: string,
  rawInput: unknown = {},
  db?: SupabaseClient,
): Promise<Job> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "bookings:assign", db);
  const idParsed = z.uuid("Invalid booking.").safeParse(bookingId);
  if (!idParsed.success) throw new AppError("Invalid booking.");
  const parsed = CreateJobInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
  const client = dbOrAdmin(db);

  try {
    const { data: booking, error: bookingError } = await client
      .from("bookings")
      .select("id, status, scheduled_at")
      .eq("tenant_id", tenantId)
      .eq("id", bookingId)
      .is("deleted_at", null)
      .maybeSingle();
    if (bookingError) throw bookingError;
    if (!booking) throw new AppError("We could not find that booking.");
    const b = booking as { id: string; status: string; scheduled_at: string | null };
    if (b.status !== "CONFIRMED" && b.status !== "SCHEDULED") {
      throw new AppError("Only confirmed bookings can become jobs.");
    }

    if (parsed.data.teamId) {
      const { data: team, error: teamError } = await client
        .from("teams")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("id", parsed.data.teamId)
        .is("deleted_at", null)
        .maybeSingle();
      if (teamError) throw teamError;
      if (!team) throw new AppError("The selected team could not be found.");
    }

    const { data, error } = await client
      .from("jobs")
      .insert({
        tenant_id: tenantId,
        booking_id: bookingId,
        team_id: parsed.data.teamId ?? null,
        status: "SCHEDULED",
        scheduled_at: parsed.data.scheduledAt || b.scheduled_at,
        notes: parsed.data.notes || null,
      })
      .select()
      .single();
    if (error) throw error;
    const job = toJob(data as Record<string, unknown>);

    await writeAudit(
      { tenantId, userId, action: "job.created", entity: "job", entityId: job.id, metadata: { bookingId } },
      { throwOnError: false },
      client,
    );
    return job;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not create this job"));
  }
}

export async function assignTeam(
  tenantId: string,
  userId: string,
  jobId: string,
  teamId: string,
  db?: SupabaseClient,
): Promise<Job> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "bookings:assign", db);
  const parsed = z
    .object({ jobId: z.uuid("Invalid job."), teamId: z.uuid("Invalid team.") })
    .safeParse({ jobId, teamId });
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request.");
  const client = dbOrAdmin(db);

  try {
    const { data: team, error: teamError } = await client
      .from("teams")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", teamId)
      .is("deleted_at", null)
      .maybeSingle();
    if (teamError) throw teamError;
    if (!team) throw new AppError("The selected team could not be found. Please refresh and try again.");

    const { data, error } = await client
      .from("jobs")
      .update({ team_id: teamId })
      .eq("tenant_id", tenantId)
      .eq("id", jobId)
      .is("deleted_at", null)
      .select()
      .single();
    if (error) throw error;
    const job = toJob(data as Record<string, unknown>);

    await writeAudit(
      { tenantId, userId, action: "job.team_assigned", entity: "job", entityId: job.id, metadata: { teamId } },
      { throwOnError: false },
      client,
    );
    return job;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not assign this team"));
  }
}

export async function assignEmployees(
  tenantId: string,
  userId: string,
  jobId: string,
  rawEmployeeIds: unknown,
  role: string = "CLEANER",
  db?: SupabaseClient,
): Promise<{ jobId: string; employeeIds: string[] }> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "bookings:assign", db);
  const parsed = z
    .object({ jobId: z.uuid("Invalid job."), employeeIds: z.array(z.uuid("Invalid employee.")).min(1, "Choose at least one team member.").max(20) })
    .safeParse({ jobId, employeeIds: rawEmployeeIds });
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request.");
  const client = dbOrAdmin(db);

  try {
    const { data: job, error: jobError } = await client
      .from("jobs")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", jobId)
      .is("deleted_at", null)
      .maybeSingle();
    if (jobError) throw jobError;
    if (!job) throw new AppError("We could not find that job.");

    const { data: employees, error: empError } = await client
      .from("employees")
      .select("id, active")
      .eq("tenant_id", tenantId)
      .in("id", parsed.data.employeeIds)
      .is("deleted_at", null);
    if (empError) throw empError;
    const rows = (employees ?? []) as Array<{ id: string; active: boolean }>;
    if (rows.length !== parsed.data.employeeIds.length) {
      throw new AppError("One of the selected team members could not be found in this business.");
    }
    const inactive = rows.find((r) => !r.active);
    if (inactive) throw new AppError("One of the selected team members is deactivated.");

    const assignmentRows = parsed.data.employeeIds.map((employeeId) => ({
      tenant_id: tenantId,
      job_id: jobId,
      employee_id: employeeId,
      role,
    }));
    const { error: assignError } = await client.from("job_assignments").upsert(assignmentRows, {
      onConflict: "job_id,employee_id",
    });
    if (assignError) throw assignError;

    await writeAudit(
      { tenantId, userId, action: "job.staff_assigned", entity: "job", entityId: jobId, metadata: { employeeIds: parsed.data.employeeIds } },
      { throwOnError: false },
      client,
    );
    return { jobId, employeeIds: parsed.data.employeeIds };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not assign staff to this job"));
  }
}

export async function updateJobStatus(
  tenantId: string,
  userId: string,
  role: string,
  jobId: string,
  rawTo: unknown,
  db?: SupabaseClient,
): Promise<Job> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "bookings:update", db);
  const parsed = z
    .object({ jobId: z.uuid("Invalid job."), to: z.enum(JOB_STATUSES, { message: "Choose a valid job status." }) })
    .safeParse({ jobId, to: rawTo });
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request.");
  const { to } = parsed.data;
  const client = dbOrAdmin(db);

  try {
    const { data: current, error: readError } = await client
      .from("jobs")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", jobId)
      .is("deleted_at", null)
      .maybeSingle();
    if (readError) throw readError;
    if (!current) throw new AppError("We could not find that job.");
    const row = current as Record<string, unknown>;
    const from = row.status as JobStatus;
    assertJobTransitionAllowed(from, to);

    // Field staff may only move jobs they are assigned to.
    if (role === "CLEANER" || role === "DRIVER") {
      const mine = await callerEmployeeId(client, tenantId, userId);
      const assigned = await assignedEmployeeIds(client, tenantId, jobId);
      assertJobAssignee(role, mine, assigned);
    }

    const patch: Record<string, unknown> = { status: to };
    const now = new Date().toISOString();
    if (to === "EN_ROUTE" && !row.started_at) patch.started_at = now;
    if (to === "IN_PROGRESS" && !row.started_at) patch.started_at = now;
    if (to === "COMPLETED") {
      if (!row.started_at) patch.started_at = now;
      patch.completed_at = now;
    }

    const { data, error } = await client
      .from("jobs")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("id", jobId)
      .select()
      .single();
    if (error) throw error;
    const job = toJob(data as Record<string, unknown>);

    // Mirror key milestones onto the booking.
    if (to === "ASSIGNED") {
      await client.from("bookings").update({ status: "ASSIGNED" }).eq("tenant_id", tenantId).eq("id", job.booking_id);
    } else if (to === "COMPLETED") {
      await client.from("bookings").update({ status: "COMPLETED" }).eq("tenant_id", tenantId).eq("id", job.booking_id);
    }

    await writeAudit(
      { tenantId, userId, action: "job.status_changed", entity: "job", entityId: job.id, metadata: { from, to } },
      { throwOnError: false },
      client,
    );

    // Best-effort WhatsApp automation — never breaks the status update.
    const jobEvent = to === "EN_ROUTE" ? "job.en_route" : to === "ARRIVED" ? "job.arrived" : to === "COMPLETED" ? "job.completed" : null;
    if (jobEvent) {
      try {
        const { data: linked } = await client
          .from("bookings")
          .select("customer_id, reference")
          .eq("tenant_id", tenantId)
          .eq("id", job.booking_id)
          .is("deleted_at", null)
          .maybeSingle();
        const booking = ((linked as { customer_id?: unknown; reference?: unknown } | null) ?? {}) as {
          customer_id?: unknown;
          reference?: unknown;
        };
        const { triggerAutomationEvent } = await import("@/services/whatsapp-automations.service");
        await triggerAutomationEvent(tenantId, jobEvent, {
          customerId: typeof booking.customer_id === "string" ? booking.customer_id : undefined,
          bookingReference: typeof booking.reference === "string" ? booking.reference : undefined,
          params: typeof booking.reference === "string" ? { bookingReference: booking.reference } : {},
        });
      } catch {
        // Automation is fire-and-forget.
      }
    }
    return job;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not update this job"));
  }
}

export async function getJob(
  tenantId: string,
  userId: string,
  jobId: string,
  db?: SupabaseClient,
): Promise<Job> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "bookings:read", db);
  const parsed = z.uuid("Invalid job.").safeParse(jobId);
  if (!parsed.success) throw new AppError("Invalid job.");
  const client = dbOrAdmin(db);

  try {
    const { data, error } = await client
      .from("jobs")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", jobId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new AppError("We could not find that job.");
    return toJob(data as Record<string, unknown>);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load this job"));
  }
}

export async function listJobs(
  tenantId: string,
  userId: string,
  rawFilter: unknown = {},
  db?: SupabaseClient,
): Promise<Job[]> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "bookings:read", db);
  const parsed = z
    .object({ status: z.enum(JOB_STATUSES).optional(), teamId: z.uuid().optional() })
    .safeParse(rawFilter);
  if (!parsed.success) throw new AppError("Invalid filter.");
  const client = dbOrAdmin(db);

  try {
    let query = client
      .from("jobs")
      .select("*")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("scheduled_at", { ascending: true })
      .limit(200);
    if (parsed.data.status) query = query.eq("status", parsed.data.status);
    if (parsed.data.teamId) query = query.eq("team_id", parsed.data.teamId);
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map(toJob);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load jobs"));
  }
}
