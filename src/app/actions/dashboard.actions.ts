"use server";

import { AppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import {
  getDashboardKpis,
  getRecentBookings,
  getRevenueTrend,
  getWhatsappEnquiries,
} from "@/services/dashboard.service";
import { getMembership } from "@/services/rbac.service";

export async function getDashboardAction(tenantIdOrSlug: string) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError("Please sign in to continue.");

    // Accept either a tenant UUID or a slug; membership is verified server-side.
    let tenantId = tenantIdOrSlug;
    if (!tenantId.match(/^[0-9a-f-]{36}$/i)) {
      const { getTenantBySlug } = await import("@/services/tenants.service");
      const { tenant } = await getTenantBySlug(user.id, tenantIdOrSlug);
      tenantId = tenant.id;
    } else {
      // Even for UUIDs, verify membership — never trust the client-supplied id.
      await getMembership(tenantId, user.id);
    }

    const [kpis, revenue, bookings, whatsapp] = await Promise.all([
      getDashboardKpis(tenantId),
      getRevenueTrend(tenantId),
      getRecentBookings(tenantId),
      getWhatsappEnquiries(tenantId),
    ]);
    return { ok: true as const, data: { kpis, revenue, bookings, whatsapp } };
  } catch (err) {
    const message =
      err instanceof AppError ? err.message : "Could not load the dashboard. Please try again.";
    return { ok: false as const, error: message };
  }
}
