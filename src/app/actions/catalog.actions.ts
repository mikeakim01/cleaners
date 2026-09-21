"use server";

import { AppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { resolveTenant, TenantAccessDeniedError } from "@/server/tenant-context";
import { PermissionDeniedError } from "@/rbac/permissions";
import { requirePermission } from "@/services/rbac.service";
import { createService, listServices, updateService, setServiceActive } from "@/services/catalog.service";

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

export async function createServiceAction(
  tenantId: string,
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof createService>>>> {
  try {
    const userId = await requireUserId();
    const verified = await verifiedTenant(userId, tenantId);
    await requirePermission(verified, userId, "services:create");
    const data = await createService(verified, userId, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function listServicesAction(
  tenantId: string,
  filter: unknown = {},
): Promise<ActionResult<Awaited<ReturnType<typeof listServices>>>> {
  try {
    const userId = await requireUserId();
    const verified = await verifiedTenant(userId, tenantId);
    await requirePermission(verified, userId, "services:read");
    const data = await listServices(verified, userId, filter);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function updateServiceAction(
  tenantId: string,
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof updateService>>>> {
  try {
    const userId = await requireUserId();
    const verified = await verifiedTenant(userId, tenantId);
    await requirePermission(verified, userId, "services:update");
    const data = await updateService(verified, userId, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function setServiceActiveAction(
  tenantId: string,
  serviceId: string,
  active: boolean,
): Promise<ActionResult<Awaited<ReturnType<typeof setServiceActive>>>> {
  try {
    const userId = await requireUserId();
    const verified = await verifiedTenant(userId, tenantId);
    await requirePermission(verified, userId, "services:update");
    const data = await setServiceActive(verified, userId, serviceId, active);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}
