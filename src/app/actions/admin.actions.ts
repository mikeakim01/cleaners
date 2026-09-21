"use server";

import { AppError } from "@/lib/errors";
import {
  createPlan,
  deactivatePlan,
  getPlatformStats,
  getTenantDetail,
  listAllTenants,
  listPlans,
  listPlatformAudit,
  NotSuperAdminError,
  requireSuperAdmin,
  setTenantSuspended,
  updatePlan,
} from "@/services/admin.service";
import { processTrialExpiries } from "@/services/billing.service";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function toError(err: unknown): string {
  if (err instanceof NotSuperAdminError) return "Platform admin access required.";
  if (err instanceof AppError) return err.message;
  if (err instanceof Error) return err.message || "Something went wrong. Please try again.";
  return "Something went wrong. Please try again.";
}

export async function getPlatformStatsAction(): Promise<ActionResult<Awaited<ReturnType<typeof getPlatformStats>>>> {
  try {
    await requireSuperAdmin();
    const data = await getPlatformStats();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function listAllTenantsAction(
  filter: unknown = {},
): Promise<ActionResult<Awaited<ReturnType<typeof listAllTenants>>>> {
  try {
    await requireSuperAdmin();
    const data = await listAllTenants(filter);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function getTenantDetailAction(
  tenantId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof getTenantDetail>>>> {
  try {
    await requireSuperAdmin();
    const data = await getTenantDetail(tenantId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function setTenantSuspendedAction(
  tenantId: string,
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof setTenantSuspended>>>> {
  try {
    await requireSuperAdmin();
    const data = await setTenantSuspended(tenantId, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function listPlansAction(): Promise<ActionResult<Awaited<ReturnType<typeof listPlans>>>> {
  try {
    await requireSuperAdmin();
    const data = await listPlans();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function createPlanAction(
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof createPlan>>>> {
  try {
    await requireSuperAdmin();
    const data = await createPlan(input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function updatePlanAction(
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof updatePlan>>>> {
  try {
    await requireSuperAdmin();
    const data = await updatePlan(input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function deactivatePlanAction(
  planId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof deactivatePlan>>>> {
  try {
    await requireSuperAdmin();
    const data = await deactivatePlan(planId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function listPlatformAuditAction(
  limit: unknown = 50,
): Promise<ActionResult<Awaited<ReturnType<typeof listPlatformAudit>>>> {
  try {
    await requireSuperAdmin();
    const data = await listPlatformAudit(limit);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function processTrialExpiriesAction(): Promise<
  ActionResult<Awaited<ReturnType<typeof processTrialExpiries>>>
> {
  try {
    await requireSuperAdmin();
    const data = await processTrialExpiries();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}
