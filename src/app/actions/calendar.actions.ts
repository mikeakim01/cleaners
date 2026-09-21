"use server";

import { AppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { resolveTenant, TenantAccessDeniedError } from "@/server/tenant-context";
import { PermissionDeniedError } from "@/rbac/permissions";
import { requirePermission } from "@/services/rbac.service";
import {
  detectConflicts,
  getAvailability,
  getDaySchedule,
  upsertAvailability,
} from "@/services/calendar.service";

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

export async function upsertAvailabilityAction(
  tenantId: string,
  employeeId: string,
  slots: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof upsertAvailability>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "users:update");
    const data = await upsertAvailability(ctx.tenantId, userId, employeeId, slots);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function getAvailabilityAction(
  tenantId: string,
  employeeId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof getAvailability>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "users:read");
    const data = await getAvailability(ctx.tenantId, userId, employeeId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function getDayScheduleAction(
  tenantId: string,
  date: string,
): Promise<ActionResult<Awaited<ReturnType<typeof getDaySchedule>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "bookings:read");
    const data = await getDaySchedule(ctx.tenantId, userId, date);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function detectConflictsAction(
  tenantId: string,
  date: string,
): Promise<ActionResult<Awaited<ReturnType<typeof detectConflicts>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "bookings:read");
    const data = await detectConflicts(ctx.tenantId, userId, date);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}
