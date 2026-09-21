"use server";

import { AppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { resolveTenant, TenantAccessDeniedError } from "@/server/tenant-context";
import { PermissionDeniedError } from "@/rbac/permissions";
import { requirePermission } from "@/services/rbac.service";
import {
  approveQuote,
  createQuote,
  getQuote,
  listQuotes,
  listQuotesForBooking,
  rejectQuote,
  sendQuote,
} from "@/services/quotes.service";

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

export async function createQuoteAction(
  tenantId: string,
  bookingId: string,
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof createQuote>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "bookings:update");
    const data = await createQuote(ctx.tenantId, userId, bookingId, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function sendQuoteAction(
  tenantId: string,
  quoteId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof sendQuote>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "bookings:update");
    const data = await sendQuote(ctx.tenantId, userId, quoteId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function approveQuoteAction(
  tenantId: string,
  quoteId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof approveQuote>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "bookings:update");
    const data = await approveQuote(ctx.tenantId, userId, quoteId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function rejectQuoteAction(
  tenantId: string,
  quoteId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof rejectQuote>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "bookings:update");
    const data = await rejectQuote(ctx.tenantId, userId, quoteId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function getQuoteAction(
  tenantId: string,
  quoteId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof getQuote>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "bookings:read");
    const data = await getQuote(ctx.tenantId, userId, quoteId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function listQuotesForBookingAction(
  tenantId: string,
  bookingId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof listQuotesForBooking>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "bookings:read");
    const data = await listQuotesForBooking(ctx.tenantId, userId, bookingId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function listQuotesAction(
  tenantId: string,
  filter: unknown = {},
): Promise<ActionResult<Awaited<ReturnType<typeof listQuotes>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "bookings:read");
    const data = await listQuotes(ctx.tenantId, userId, filter);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}
