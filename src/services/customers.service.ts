import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, humanizeDbError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/server/supabase-admin";
import { writeAudit } from "@/services/audit.service";
import { requirePermission } from "@/services/rbac.service";

export const TANZANIA_PHONE_REGEX = /^\+255\d{9}$/;

export const CreateCustomerInputSchema = z.object({
  name: z.string().trim().min(2, "Customer name must be at least 2 characters.").max(120),
  phone: z
    .string()
    .trim()
    .regex(TANZANIA_PHONE_REGEX, "Phone must be a Tanzanian number like +255712345678."),
  email: z.string().trim().email("Enter a valid email address.").max(160).optional().or(z.literal("")),
  branchId: z.uuid("Invalid branch.").optional(),
  address: z.string().trim().max(255).optional().default(""),
  ward: z.string().trim().max(80).optional().default(""),
  vip: z.boolean().optional().default(false),
  notes: z.string().trim().max(1000).optional().default(""),
});

export const UpdateCustomerInputSchema = CreateCustomerInputSchema.partial().extend({
  id: z.uuid("Invalid customer."),
});

export const ListCustomersFilterSchema = z.object({
  search: z.string().trim().max(120).optional(),
  branchId: z.uuid("Invalid branch.").optional(),
});

export type CreateCustomerInput = z.infer<typeof CreateCustomerInputSchema>;
export type UpdateCustomerInput = z.infer<typeof UpdateCustomerInputSchema>;
export type ListCustomersFilter = z.infer<typeof ListCustomersFilterSchema>;

export interface Customer {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  full_name: string;
  vip: boolean;
  phone_e164: string;
  email: string | null;
  address: string | null;
  ward: string | null;
  notes: string | null;
  created_at: string;
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

function toCustomer(row: Record<string, unknown>): Customer {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    branch_id: (row.branch_id as string | null) ?? null,
    full_name: String(row.full_name ?? ""),
    vip: Boolean(row.vip ?? false),
    phone_e164: String(row.phone_e164 ?? ""),
    email: (row.email as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    ward: (row.ward as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    created_at: String(row.created_at ?? ""),
  };
}

export async function createCustomer(
  tenantId: string,
  userId: string,
  rawInput: unknown,
  db?: SupabaseClient,
): Promise<Customer> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "customers:create", db);
  const parsed = CreateCustomerInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
  const input = parsed.data;
  const client = dbOrAdmin(db);

  try {
    const { data: dup, error: dupError } = await client
      .from("customers")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("phone_e164", input.phone)
      .is("deleted_at", null)
      .limit(1);
    if (dupError) throw dupError;
    if (dup && dup.length > 0) {
      throw new AppError("This phone number is already registered for this business.");
    }

    const { data, error } = await client
      .from("customers")
      .insert({
        tenant_id: tenantId,
        branch_id: input.branchId ?? null,
        full_name: input.name,
        phone_e164: input.phone,
        email: input.email || null,
        address: input.address || null,
        ward: input.ward || null,
        vip: input.vip,
        notes: input.notes || null,
      })
      .select()
      .single();
    if (error) throw error;
    const customer = toCustomer(data as Record<string, unknown>);

    await writeAudit(
      { tenantId, userId, action: "customer.created", entity: "customer", entityId: customer.id, metadata: { name: input.name } },
      { throwOnError: false },
      client,
    );
    return customer;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not add this customer"));
  }
}

export async function listCustomers(
  tenantId: string,
  userId: string,
  rawFilter: unknown = {},
  db?: SupabaseClient,
): Promise<Customer[]> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "customers:read", db);
  const parsed = ListCustomersFilterSchema.safeParse(rawFilter);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid search.");
  const client = dbOrAdmin(db);

  try {
    let query = client
      .from("customers")
      .select("id, tenant_id, branch_id, full_name, vip, phone_e164, email, address, ward, notes, created_at")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200);
    if (parsed.data.branchId) query = query.eq("branch_id", parsed.data.branchId);
    if (parsed.data.search) {
      const s = parsed.data.search.replace(/[%_]/g, "");
      query = query.or(`full_name.ilike.%${s}%,phone_e164.ilike.%${s}%,email.ilike.%${s}%`);
    }
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map(toCustomer);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load customers"));
  }
}

export async function updateCustomer(
  tenantId: string,
  userId: string,
  rawInput: unknown,
  db?: SupabaseClient,
): Promise<Customer> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "customers:update", db);
  const parsed = UpdateCustomerInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
  const { id, ...input } = parsed.data;
  const client = dbOrAdmin(db);

  try {
    if (input.phone) {
      const { data: dup, error: dupError } = await client
        .from("customers")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("phone_e164", input.phone)
        .neq("id", id)
        .is("deleted_at", null)
        .limit(1);
      if (dupError) throw dupError;
      if (dup && dup.length > 0) {
        throw new AppError("This phone number is already registered for this business.");
      }
    }

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.full_name = input.name;
    if (input.phone !== undefined) patch.phone_e164 = input.phone;
    if (input.email !== undefined) patch.email = input.email || null;
    if (input.branchId !== undefined) patch.branch_id = input.branchId;
    if (input.address !== undefined) patch.address = input.address || null;
    if (input.ward !== undefined) patch.ward = input.ward || null;
    if (input.vip !== undefined) patch.vip = input.vip;
    if (input.notes !== undefined) patch.notes = input.notes || null;
    if (Object.keys(patch).length === 0) throw new AppError("Nothing to update.");

    const { data, error } = await client
      .from("customers")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .is("deleted_at", null)
      .select()
      .single();
    if (error) throw error;
    const customer = toCustomer(data as Record<string, unknown>);

    await writeAudit(
      { tenantId, userId, action: "customer.updated", entity: "customer", entityId: customer.id, metadata: {} },
      { throwOnError: false },
      client,
    );
    return customer;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not update this customer"));
  }
}
