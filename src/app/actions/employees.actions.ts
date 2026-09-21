"use server";

import { AppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { resolveTenant, TenantAccessDeniedError } from "@/server/tenant-context";
import { PermissionDeniedError } from "@/rbac/permissions";
import { requirePermission } from "@/services/rbac.service";
import {
  createEmployee,
  deactivateEmployee,
  linkUser,
  listEmployees,
  updateEmployee,
} from "@/services/employees.service";
import {
  addTeamMember,
  createTeam,
  listTeamMembers,
  listTeams,
  removeTeamMember,
} from "@/services/teams.service";

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

export async function createEmployeeAction(
  tenantId: string,
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof createEmployee>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "users:invite");
    const data = await createEmployee(ctx.tenantId, userId, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function listEmployeesAction(
  tenantId: string,
  filter: unknown = {},
): Promise<ActionResult<Awaited<ReturnType<typeof listEmployees>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "users:read");
    const data = await listEmployees(ctx.tenantId, userId, filter);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function updateEmployeeAction(
  tenantId: string,
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof updateEmployee>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "users:update");
    const data = await updateEmployee(ctx.tenantId, userId, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function deactivateEmployeeAction(
  tenantId: string,
  employeeId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof deactivateEmployee>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "users:deactivate");
    const data = await deactivateEmployee(ctx.tenantId, userId, employeeId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function linkEmployeeUserAction(
  tenantId: string,
  employeeId: string,
  targetUserId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof linkUser>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "users:update");
    const data = await linkUser(ctx.tenantId, userId, employeeId, targetUserId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function createTeamAction(
  tenantId: string,
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof createTeam>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "users:update");
    const data = await createTeam(ctx.tenantId, userId, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function listTeamsAction(
  tenantId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof listTeams>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "users:read");
    const data = await listTeams(ctx.tenantId, userId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function addTeamMemberAction(
  tenantId: string,
  teamId: string,
  employeeId: string,
): Promise<ActionResult<null>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "users:update");
    await addTeamMember(ctx.tenantId, userId, teamId, employeeId);
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function removeTeamMemberAction(
  tenantId: string,
  teamId: string,
  employeeId: string,
): Promise<ActionResult<null>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "users:update");
    await removeTeamMember(ctx.tenantId, userId, teamId, employeeId);
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function listTeamMembersAction(
  tenantId: string,
  teamId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof listTeamMembers>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "users:read");
    const data = await listTeamMembers(ctx.tenantId, userId, teamId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}
