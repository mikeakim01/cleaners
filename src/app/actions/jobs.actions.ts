"use server";

import { AppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { resolveTenant, TenantAccessDeniedError } from "@/server/tenant-context";
import { PermissionDeniedError } from "@/rbac/permissions";
import { requirePermission } from "@/services/rbac.service";
import {
  assignEmployees,
  assignTeam,
  createJobFromBooking,
  getJob,
  listJobs,
  updateJobStatus,
} from "@/services/jobs.service";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function toError(err: unknown): string {
  if (err instanceof AppError) return err.message;
  if (err instanceof TenantAccessDeniedError) return "You do not have access to this business.";
  if (err instanceof PermissionDeniedError) return "You do not have permission to do that. Ask your manager for access.";
  if (err instanceof Error) return err.message || "Something went wrong. Please try again.";
  return "Something went wrong. Please try again.";
}

async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new AppError("Please sign in to continue.");
  return user.id;
}

export async function createJobFromBookingAction(
  tenantId: string,
  bookingId: string,
  input: unknown = {},
): Promise<ActionResult<Awaited<ReturnType<typeof createJobFromBooking>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "bookings:assign");
    const data = await createJobFromBooking(ctx.tenantId, userId, bookingId, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function assignTeamAction(
  tenantId: string,
  jobId: string,
  teamId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof assignTeam>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "bookings:assign");
    const data = await assignTeam(ctx.tenantId, userId, jobId, teamId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function assignEmployeesAction(
  tenantId: string,
  jobId: string,
  employeeIds: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof assignEmployees>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "bookings:assign");
    const data = await assignEmployees(ctx.tenantId, userId, jobId, employeeIds, ctx.role);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function updateJobStatusAction(
  tenantId: string,
  jobId: string,
  to: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof updateJobStatus>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "bookings:update");
    const data = await updateJobStatus(ctx.tenantId, userId, ctx.role, jobId, to);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function getJobAction(
  tenantId: string,
  jobId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof getJob>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "bookings:read");
    const data = await getJob(ctx.tenantId, userId, jobId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function listJobsAction(
  tenantId: string,
  filter: unknown = {},
): Promise<ActionResult<Awaited<ReturnType<typeof listJobs>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "bookings:read");
    const data = await listJobs(ctx.tenantId, userId, filter);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}
