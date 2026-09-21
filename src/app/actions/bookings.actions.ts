"use server";

import { AppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { resolveTenant, TenantAccessDeniedError } from "@/server/tenant-context";
import { PermissionDeniedError } from "@/rbac/permissions";
import { requirePermission } from "@/services/rbac.service";
import {
  createBooking,
  getBooking,
  getBookingByReference,
  listBookings,
  transitionBooking,
  transitionBookingByReference,
} from "@/services/bookings.service";

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

export async function createBookingAction(
  tenantId: string,
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof createBooking>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "bookings:create");
    const data = await createBooking(ctx.tenantId, userId, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function getBookingAction(
  tenantId: string,
  bookingId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof getBooking>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "bookings:read");
    const data = await getBooking(ctx.tenantId, userId, bookingId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function listBookingsAction(
  tenantId: string,
  filter: unknown = {},
): Promise<ActionResult<Awaited<ReturnType<typeof listBookings>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "bookings:read");
    const data = await listBookings(ctx.tenantId, userId, filter);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function transitionBookingAction(
  tenantId: string,
  bookingId: string,
  to: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof transitionBooking>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, to === "CANCELLED" ? "bookings:cancel" : "bookings:update");
    const data = await transitionBooking(ctx.tenantId, userId, ctx.role, bookingId, to);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function getBookingByReferenceAction(
  tenantId: string,
  reference: string,
): Promise<ActionResult<Awaited<ReturnType<typeof getBookingByReference>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "bookings:read");
    const data = await getBookingByReference(ctx.tenantId, userId, reference);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function transitionBookingByReferenceAction(
  tenantId: string,
  reference: string,
  to: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof transitionBookingByReference>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, to === "CANCELLED" ? "bookings:cancel" : "bookings:update");
    const data = await transitionBookingByReference(ctx.tenantId, userId, ctx.role, reference, to);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}
