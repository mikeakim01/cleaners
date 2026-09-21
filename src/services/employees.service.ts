import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, humanizeDbError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/server/supabase-admin";
import { writeAudit } from "@/services/audit.service";
import { requirePermission } from "@/services/rbac.service";
import { assertWithinLimits } from "@/services/subscriptions.service";

export const TANZANIA_PHONE_REGEX = /^\+255\d{9}$/;

export const EMPLOYEE_ROLES = ["CLEANER", "DRIVER", "SUPERVISOR", "MANAGER"] as const;
export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

export const CreateEmployeeInputSchema = z.object({
  fullName: z.string().trim().min(2, "Employee name must be at least 2 characters.").max(120),
  phone: z
    .string()
    .trim()
    .regex(TANZANIA_PHONE_REGEX, "Phone must be a Tanzanian number like +255712345678.")
    .optional(),
  role: z.enum(EMPLOYEE_ROLES, { message: "Choose a valid employee role." }),
  branchId: z.uuid("Invalid branch.").optional(),
});

export const UpdateEmployeeInputSchema = z.object({
  id: z.uuid("Invalid employee."),
  fullName: z.string().trim().min(2, "Employee name must be at least 2 characters.").max(120).optional(),
  phone: z
    .string()
    .trim()
    .regex(TANZANIA_PHONE_REGEX, "Phone must be a Tanzanian number like +255712345678.")
    .optional(),
  role: z.enum(EMPLOYEE_ROLES, { message: "Choose a valid employee role." }).optional(),
  branchId: z.uuid("Invalid branch.").nullable().optional(),
});

export type CreateEmployeeInput = z.infer<typeof CreateEmployeeInputSchema>;
export type UpdateEmployeeInput = z.infer<typeof UpdateEmployeeInputSchema>;

export interface Employee {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  user_id: string | null;
  full_name: string;
  phone_e164: string | null;
  role: EmployeeRole;
  active: boolean;
}

function dbOrAdmin(db?: SupabaseClient): SupabaseClient {
  return db ?? getSupabaseAdmin();
}

function checkIds(tenantId: string, userId: string): void {
  const parsed = z
    .object({ tenantId: z.uuid("Invalid business."), userId: z.uuid("Invalid user. Please sign in again.") })
    .safeParse({ tenantId, userId });
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request.");
}

function toEmployee(row: Record<string, unknown>): Employee {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    branch_id: (row.branch_id as string | null) ?? null,
    user_id: (row.user_id as string | null) ?? null,
    full_name: String(row.full_name ?? ""),
    phone_e164: (row.phone_e164 as string | null) ?? null,
    role: row.role as EmployeeRole,
    active: Boolean(row.active ?? true),
  };
}

export async function createEmployee(
  tenantId: string,
  userId: string,
  rawInput: unknown,
  db?: SupabaseClient,
): Promise<Employee> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "users:invite", db);
  const parsed = CreateEmployeeInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
  const input = parsed.data;
  const client = dbOrAdmin(db);
  await assertWithinLimits(tenantId, "staff", client);

  try {
    const { data, error } = await client
      .from("employees")
      .insert({
        tenant_id: tenantId,
        branch_id: input.branchId ?? null,
        full_name: input.fullName,
        phone_e164: input.phone ?? null,
        role: input.role,
        active: true,
      })
      .select()
      .single();
    if (error) throw error;
    const employee = toEmployee(data as Record<string, unknown>);

    await writeAudit(
      { tenantId, userId, action: "employee.created", entity: "employee", entityId: employee.id, metadata: { name: input.fullName, role: input.role } },
      { throwOnError: false },
      client,
    );
    return employee;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not add this team member"));
  }
}

export async function listEmployees(
  tenantId: string,
  userId: string,
  rawFilter: unknown = {},
  db?: SupabaseClient,
): Promise<Employee[]> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "users:read", db);
  const parsed = z
    .object({ activeOnly: z.boolean().optional().default(false), branchId: z.uuid().optional() })
    .safeParse(rawFilter);
  if (!parsed.success) throw new AppError("Invalid filter.");
  const client = dbOrAdmin(db);

  try {
    let query = client
      .from("employees")
      .select("id, tenant_id, branch_id, user_id, full_name, phone_e164, role, active")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("full_name", { ascending: true })
      .limit(200);
    if (parsed.data.activeOnly) query = query.eq("active", true);
    if (parsed.data.branchId) query = query.eq("branch_id", parsed.data.branchId);
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map(toEmployee);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load team members"));
  }
}

export async function updateEmployee(
  tenantId: string,
  userId: string,
  rawInput: unknown,
  db?: SupabaseClient,
): Promise<Employee> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "users:update", db);
  const parsed = UpdateEmployeeInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
  const { id, ...input } = parsed.data;
  const client = dbOrAdmin(db);

  try {
    const patch: Record<string, unknown> = {};
    if (input.fullName !== undefined) patch.full_name = input.fullName;
    if (input.phone !== undefined) patch.phone_e164 = input.phone;
    if (input.role !== undefined) patch.role = input.role;
    if (input.branchId !== undefined) patch.branch_id = input.branchId;
    if (Object.keys(patch).length === 0) throw new AppError("Nothing to update.");

    const { data, error } = await client
      .from("employees")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .is("deleted_at", null)
      .select()
      .single();
    if (error) throw error;
    const employee = toEmployee(data as Record<string, unknown>);

    await writeAudit(
      { tenantId, userId, action: "employee.updated", entity: "employee", entityId: employee.id, metadata: {} },
      { throwOnError: false },
      client,
    );
    return employee;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not update this team member"));
  }
}

export async function deactivateEmployee(
  tenantId: string,
  userId: string,
  employeeId: string,
  db?: SupabaseClient,
): Promise<Employee> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "users:deactivate", db);
  const parsed = z.uuid("Invalid employee.").safeParse(employeeId);
  if (!parsed.success) throw new AppError("Invalid employee.");
  const client = dbOrAdmin(db);

  try {
    const { data, error } = await client
      .from("employees")
      .update({ active: false })
      .eq("tenant_id", tenantId)
      .eq("id", employeeId)
      .is("deleted_at", null)
      .select()
      .single();
    if (error) throw error;
    const employee = toEmployee(data as Record<string, unknown>);

    await writeAudit(
      { tenantId, userId, action: "employee.deactivated", entity: "employee", entityId: employee.id, metadata: {} },
      { throwOnError: false },
      client,
    );
    return employee;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not deactivate this team member"));
  }
}

/** Binds an auth user to an employee record so field staff can sign in. */
export async function linkUser(
  tenantId: string,
  userId: string,
  employeeId: string,
  targetUserId: string,
  db?: SupabaseClient,
): Promise<Employee> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "users:update", db);
  const parsed = z
    .object({ employeeId: z.uuid("Invalid employee."), targetUserId: z.uuid("Invalid user.") })
    .safeParse({ employeeId, targetUserId });
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request.");
  const client = dbOrAdmin(db);

  try {
    const { data, error } = await client
      .from("employees")
      .update({ user_id: targetUserId })
      .eq("tenant_id", tenantId)
      .eq("id", employeeId)
      .is("deleted_at", null)
      .select()
      .single();
    if (error) throw error;
    const employee = toEmployee(data as Record<string, unknown>);

    await writeAudit(
      { tenantId, userId, action: "employee.linked", entity: "employee", entityId: employee.id, metadata: {} },
      { throwOnError: false },
      client,
    );
    return employee;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not link this account"));
  }
}
