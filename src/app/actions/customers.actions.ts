"use server";

import { AppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { resolveTenant, TenantAccessDeniedError } from "@/server/tenant-context";
import { PermissionDeniedError } from "@/rbac/permissions";
import { requirePermission } from "@/services/rbac.service";
import { createCustomer, listCustomers, updateCustomer } from "@/services/customers.service";

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

async function verifiedTenant(userId: string, tenantId: string): Promise<string> {
  const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
  return ctx.tenantId;
}

export async function createCustomerAction(
  tenantId: string,
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof createCustomer>>>> {
  try {
    const userId = await requireUserId();
    const verified = await verifiedTenant(userId, tenantId);
    await requirePermission(verified, userId, "customers:create");
    const data = await createCustomer(verified, userId, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function listCustomersAction(
  tenantId: string,
  filter: unknown = {},
): Promise<ActionResult<Awaited<ReturnType<typeof listCustomers>>>> {
  try {
    const userId = await requireUserId();
    const verified = await verifiedTenant(userId, tenantId);
    await requirePermission(verified, userId, "customers:read");
    const data = await listCustomers(verified, userId, filter);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function updateCustomerAction(
  tenantId: string,
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof updateCustomer>>>> {
  try {
    const userId = await requireUserId();
    const verified = await verifiedTenant(userId, tenantId);
    await requirePermission(verified, userId, "customers:update");
    const data = await updateCustomer(verified, userId, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}
