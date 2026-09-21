import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, humanizeDbError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/server/supabase-admin";
import { writeAudit } from "@/services/audit.service";
import { requirePermission } from "@/services/rbac.service";

export const PRICING_MODELS = [
  "FIXED",
  "PER_HOUR",
  "PER_ROOM",
  "PER_SQM",
  "PER_ITEM",
  "PER_UNIT",
  "CUSTOM_QUOTE",
] as const;

export type PricingModel = (typeof PRICING_MODELS)[number];

export const CreateServiceInputSchema = z.object({
  name: z.string().trim().min(2, "Service name must be at least 2 characters.").max(120),
  pricingModel: z.enum(PRICING_MODELS, { message: "Choose a valid pricing model." }),
  baseMinor: z.number().int("Price must be a whole number of cents.").min(0, "Price cannot be negative."),
  unitMinor: z.number().int("Unit price must be a whole number of cents.").min(0, "Unit price cannot be negative.").optional().default(0),
  description: z.string().trim().max(1000).optional().default(""),
});

export const UpdateServiceInputSchema = CreateServiceInputSchema.partial().extend({
  id: z.uuid("Invalid service."),
});

export const ListServicesFilterSchema = z.object({
  activeOnly: z.boolean().optional().default(true),
});

export type CreateServiceInput = z.infer<typeof CreateServiceInputSchema>;
export type UpdateServiceInput = z.infer<typeof UpdateServiceInputSchema>;

export interface CatalogService {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  pricing_model: PricingModel;
  base_price_minor: number;
  unit_price_minor: number;
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

function toService(row: Record<string, unknown>): CatalogService {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    name: String(row.name ?? ""),
    description: (row.description as string | null) ?? null,
    pricing_model: row.pricing_model as PricingModel,
    base_price_minor: Number(row.base_price_minor ?? 0),
    unit_price_minor: Number(row.unit_price_minor ?? 0),
    active: Boolean(row.active ?? true),
  };
}

export async function createService(
  tenantId: string,
  userId: string,
  rawInput: unknown,
  db?: SupabaseClient,
): Promise<CatalogService> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "services:create", db);
  const parsed = CreateServiceInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
  const input = parsed.data;
  const client = dbOrAdmin(db);

  try {
    const { data, error } = await client
      .from("services")
      .insert({
        tenant_id: tenantId,
        name: input.name,
        description: input.description || null,
        pricing_model: input.pricingModel,
        base_price_minor: input.baseMinor,
        unit_price_minor: input.unitMinor,
        active: true,
      })
      .select()
      .single();
    if (error) throw error;
    const service = toService(data as Record<string, unknown>);

    await writeAudit(
      { tenantId, userId, action: "service.created", entity: "service", entityId: service.id, metadata: { name: input.name } },
      { throwOnError: false },
      client,
    );
    return service;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not add this service"));
  }
}

export async function listServices(
  tenantId: string,
  userId: string,
  rawFilter: unknown = {},
  db?: SupabaseClient,
): Promise<CatalogService[]> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "services:read", db);
  const parsed = ListServicesFilterSchema.safeParse(rawFilter);
  if (!parsed.success) throw new AppError("Invalid filter.");
  const client = dbOrAdmin(db);

  try {
    let query = client
      .from("services")
      .select("id, tenant_id, name, description, pricing_model, base_price_minor, unit_price_minor, active")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("name", { ascending: true })
      .limit(200);
    if (parsed.data.activeOnly) query = query.eq("active", true);
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map(toService);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load services"));
  }
}

export async function updateService(
  tenantId: string,
  userId: string,
  rawInput: unknown,
  db?: SupabaseClient,
): Promise<CatalogService> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "services:update", db);
  const parsed = UpdateServiceInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
  const { id, ...input } = parsed.data;
  const client = dbOrAdmin(db);

  try {
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description || null;
    if (input.pricingModel !== undefined) patch.pricing_model = input.pricingModel;
    if (input.baseMinor !== undefined) patch.base_price_minor = input.baseMinor;
    if (input.unitMinor !== undefined) patch.unit_price_minor = input.unitMinor;
    if (Object.keys(patch).length === 0) throw new AppError("Nothing to update.");

    const { data, error } = await client
      .from("services")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .is("deleted_at", null)
      .select()
      .single();
    if (error) throw error;
    const service = toService(data as Record<string, unknown>);

    await writeAudit(
      { tenantId, userId, action: "service.updated", entity: "service", entityId: service.id, metadata: {} },
      { throwOnError: false },
      client,
    );
    return service;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not update this service"));
  }
}

export async function setServiceActive(
  tenantId: string,
  userId: string,
  serviceId: string,
  active: boolean,
  db?: SupabaseClient,
): Promise<CatalogService> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "services:update", db);
  const parsed = z.uuid("Invalid service.").safeParse(serviceId);
  if (!parsed.success) throw new AppError("Invalid service.");
  const client = dbOrAdmin(db);

  try {
    const { data, error } = await client
      .from("services")
      .update({ active })
      .eq("tenant_id", tenantId)
      .eq("id", serviceId)
      .is("deleted_at", null)
      .select()
      .single();
    if (error) throw error;
    const service = toService(data as Record<string, unknown>);
    await writeAudit(
      { tenantId, userId, action: active ? "service.activated" : "service.deactivated", entity: "service", entityId: service.id, metadata: {} },
      { throwOnError: false },
      client,
    );
    return service;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not update this service"));
  }
}
