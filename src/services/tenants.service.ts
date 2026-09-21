import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, humanizeDbError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/server/supabase-admin";
import { writeAudit } from "@/services/audit.service";

export const TANZANIA_PHONE_REGEX = /^\+255\d{9}$/;

export const BranchInputSchema = z.object({
  name: z.string().trim().min(2, "Branch name must be at least 2 characters.").max(80),
  ward: z.string().trim().max(80).optional().default(""),
});

export const CreateTenantInputSchema = z.object({
  name: z.string().trim().min(3, "Business name must be at least 3 characters.").max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "URL handle must be at least 3 characters.")
    .max(40)
    .regex(/^[a-z0-9-]+$/, "URL handle may only contain lowercase letters, numbers and dashes."),
  phone: z
    .string()
    .trim()
    .regex(TANZANIA_PHONE_REGEX, "Phone must be a Tanzanian number like +255712345678."),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Brand color must be a hex code like #0F766E.").optional().default("#0F766E"),
  branches: z.array(BranchInputSchema).min(1, "Add at least one branch.").max(20),
});

export type CreateTenantInput = z.infer<typeof CreateTenantInputSchema>;
export type BranchInput = z.infer<typeof BranchInputSchema>;

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  phone_e164: string | null;
  primary_color: string;
  created_at: string;
}

type Db = SupabaseClient;
function dbOrAdmin(db?: Db): Db {
  return db ?? getSupabaseAdmin();
}

export async function createTenant(
  userId: string,
  rawInput: unknown,
  requestIp?: string,
  db?: Db,
): Promise<Tenant> {
  const client = dbOrAdmin(db);
  const userParsed = z.string().uuid("Invalid user. Please sign in again.").safeParse(userId);
  if (!userParsed.success) throw new AppError("Invalid user. Please sign in again.");
  const parsed = CreateTenantInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
  }
  const input = parsed.data;

  try {
    const { data: existing, error: lookupError } = await client
      .from("tenants")
      .select("id")
      .or(`slug.eq.${input.slug},name.eq.${input.name}`)
      .is("deleted_at", null)
      .limit(1);
    if (lookupError) throw lookupError;
    if (existing && existing.length > 0) {
      throw new AppError("This business name is already taken. Try another name or URL handle.");
    }

    const { data: tenant, error: insertError } = await client
      .from("tenants")
      .insert({
        name: input.name,
        slug: input.slug,
        phone_e164: input.phone,
        primary_color: input.primaryColor,
      })
      .select()
      .single();
    if (insertError) throw insertError;
    const created = tenant as Tenant;

    const { error: memberError } = await client.from("tenant_members").insert({
      tenant_id: created.id,
      user_id: userId,
      role: "OWNER",
    });
    if (memberError) throw memberError;

    const branchRows = input.branches.map((b, i) => ({
      tenant_id: created.id,
      name: b.name,
      ward: b.ward || null,
      is_hq: i === 0,
    }));
    const { error: branchError } = await client.from("branches").insert(branchRows);
    if (branchError) throw branchError;

    await client.from("business_settings").insert({
      tenant_id: created.id,
      business_name: input.name,
    });

    // Start a trial subscription on the Starter plan when one exists.
    try {
      const { data: plan } = await client
        .from("plans")
        .select("id, trial_days")
        .eq("name", "Starter")
        .eq("active", true)
        .is("deleted_at", null)
        .maybeSingle();
      if (plan) {
        const trialDays = (plan as { trial_days: number }).trial_days ?? 14;
        await client.from("subscriptions").insert({
          tenant_id: created.id,
          plan_id: (plan as { id: string }).id,
          status: "trialing",
          trial_ends_at: new Date(Date.now() + trialDays * 86_400_000).toISOString(),
        });
      }
    } catch {
      // Subscription bootstrap is best-effort; the tenant itself is usable without it.
    }

    await writeAudit(
      {
        tenantId: created.id,
        userId,
        action: "tenant.created",
        entity: "tenant",
        entityId: created.id,
        metadata: { name: input.name, slug: input.slug },
        ip: requestIp,
      },
      { throwOnError: false },
      client,
    );

    return created;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not create your business"));
  }
}

export async function listMyTenants(userId: string, db?: Db) {
  const client = dbOrAdmin(db);
  const parsed = z.string().uuid("Invalid user. Please sign in again.").safeParse(userId);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid user.");

  try {
    const { data, error } = await client
      .from("tenant_members")
      .select("role, tenants ( id, name, slug, phone_e164, primary_color, created_at )")
      .eq("user_id", userId)
      .is("deleted_at", null);
    if (error) throw error;
    return (data ?? []).map((row) => ({
      role: row.role as string,
      tenant: (Array.isArray(row.tenants) ? row.tenants[0] : row.tenants) as unknown as Tenant,
    }));
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load your businesses"));
  }
}

export async function getTenantBySlug(userId: string, rawSlug: unknown, db?: Db) {
  const client = dbOrAdmin(db);
  const slugParsed = z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Business link is missing.")
    .safeParse(rawSlug);
  if (!slugParsed.success) throw new AppError("Business link is missing or invalid.");
  const slug = slugParsed.data;

  try {
    const { data: tenant, error: tenantError } = await client
      .from("tenants")
      .select("id, name, slug, phone_e164, primary_color, created_at")
      .eq("slug", slug)
      .is("deleted_at", null)
      .maybeSingle();
    if (tenantError) throw tenantError;
    if (!tenant) {
      throw new AppError("We could not find that business. Check the link or ask your manager for access.");
    }
    const found = tenant as Tenant;

    const { data: membership, error: memberError } = await client
      .from("tenant_members")
      .select("role")
      .eq("tenant_id", found.id)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (memberError) throw memberError;
    if (!membership) {
      throw new AppError("You do not have access to this business. Ask an admin to invite you.");
    }

    return { tenant: found, role: (membership as { role: string }).role };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load this business"));
  }
}
