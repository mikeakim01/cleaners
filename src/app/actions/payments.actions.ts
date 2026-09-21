"use server";

import { AppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { resolveTenant, TenantAccessDeniedError } from "@/server/tenant-context";
import { PermissionDeniedError } from "@/rbac/permissions";
import { requirePermission } from "@/services/rbac.service";
import {
  listPayments,
  listTenantPayments,
  recordPayment,
} from "@/services/payments.service";

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

export async function recordPaymentAction(
  tenantId: string,
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof recordPayment>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "payments:record");
    const data = await recordPayment(ctx.tenantId, userId, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function listPaymentsAction(
  tenantId: string,
  invoiceId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof listPayments>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "payments:record");
    const data = await listPayments(ctx.tenantId, userId, invoiceId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function listTenantPaymentsAction(
  tenantId: string,
  filter: unknown = {},
): Promise<ActionResult<Awaited<ReturnType<typeof listTenantPayments>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "payments:record");
    const data = await listTenantPayments(ctx.tenantId, userId, filter);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}
