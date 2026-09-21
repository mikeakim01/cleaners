"use server";

import { AppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { resolveTenant, TenantAccessDeniedError } from "@/server/tenant-context";
import { PermissionDeniedError } from "@/rbac/permissions";
import { requirePermission } from "@/services/rbac.service";
import { getMyJobs, listMySchedule } from "@/services/cleaner.service";
import { listJobPhotos, uploadJobPhoto } from "@/services/files.service";

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

export async function getMyJobsAction(
  tenantId: string,
  filter: unknown = {},
): Promise<ActionResult<Awaited<ReturnType<typeof getMyJobs>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "bookings:read");
    const data = await getMyJobs(ctx.tenantId, userId, filter);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function getMyScheduleAction(
  tenantId: string,
  weekStartISO: string,
): Promise<ActionResult<Awaited<ReturnType<typeof listMySchedule>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "bookings:read");
    const data = await listMySchedule(ctx.tenantId, userId, weekStartISO);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function uploadJobPhotoAction(
  tenantId: string,
  jobId: string,
  input: { kind: unknown; contentBase64: string; mime: string },
): Promise<ActionResult<Awaited<ReturnType<typeof uploadJobPhoto>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "bookings:update");
    const data = await uploadJobPhoto(ctx.tenantId, userId, { ...input, jobId });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function listJobPhotosAction(
  tenantId: string,
  jobId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof listJobPhotos>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "bookings:read");
    const data = await listJobPhotos(ctx.tenantId, userId, jobId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}
