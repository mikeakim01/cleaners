"use client";

import { useTenant } from "@/hooks/useTenants";
import { hasPermission, type Permission, type Role } from "@/rbac/permissions";

/**
 * Client-side gate for hiding/disabling UI. Always enforce on the server too
 * via rbac.service requirePermission — this hook never grants access by itself.
 */
export function useRequirePerm(slug: string, permission: Permission) {
  const tenantQuery = useTenant(slug);
  const role = (tenantQuery.data?.role ?? null) as Role | null;
  const allowed = role ? hasPermission(role, permission) : false;
  return { ...tenantQuery, role, allowed };
}
