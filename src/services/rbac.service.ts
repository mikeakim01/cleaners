import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/server/supabase-admin";
import {
  hasPermission as checkPermission,
  isPermission,
  isRole,
  requirePerm,
  type ExtraPermissions,
  type Permission,
  type Role,
} from "@/rbac/permissions";

const MembershipLookupSchema = z.object({
  tenantId: z.string().uuid("Invalid business."),
  userId: z.string().uuid("Invalid user. Please sign in again."),
});

export interface Membership {
  role: Role;
  extra: ExtraPermissions | null;
}

export async function getMembership(
  tenantId: string,
  userId: string,
  db?: SupabaseClient,
): Promise<Membership> {
  const parsed = MembershipLookupSchema.safeParse({ tenantId, userId });
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid membership.");
  const client = db ?? getSupabaseAdmin();
  const { data, error } = await client
    .from("tenant_members")
    .select("role, extra_permissions")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new AppError("Could not check your permissions. Please refresh and try again.");
  if (!data) throw new AppError("You do not have access to this business.");
  const row = data as { role: unknown; extra_permissions: unknown };
  if (!isRole(row.role)) {
    throw new AppError("Your access level is invalid. Ask an admin to re-invite you.");
  }
  const extra = (row.extra_permissions ?? null) as ExtraPermissions | null;
  return { role: row.role, extra };
}

/** Wraps src/rbac/permissions: asserts the membership holds the permission (deny-first overrides). */
export async function requirePermission(
  tenantId: string,
  userId: string,
  permission: string,
  db?: SupabaseClient,
): Promise<Role> {
  if (!isPermission(permission)) throw new AppError("Unknown permission requested.");
  const perm: Permission = permission;
  const { role, extra } = await getMembership(tenantId, userId, db);
  try {
    requirePerm(role, perm, extra);
  } catch {
    throw new AppError("You do not have permission to do that. Ask your manager for access.");
  }
  return role;
}

export async function hasPermission(
  tenantId: string,
  userId: string,
  permission: string,
  db?: SupabaseClient,
): Promise<boolean> {
  if (!isPermission(permission)) return false;
  try {
    const { role, extra } = await getMembership(tenantId, userId, db);
    return checkPermission(role, permission, extra);
  } catch {
    return false;
  }
}
