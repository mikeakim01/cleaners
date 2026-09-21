import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, humanizeDbError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/server/supabase-admin";
import { writeAudit } from "@/services/audit.service";
import { getTenantBySlug } from "@/services/tenants.service";

const BranchDraftSchema = z.object({
  name: z.string().trim().min(2).max(80),
  ward: z.string().trim().max(80).optional().default(""),
});

// Only keys that map to real business_settings / tenants / branches columns are
// persisted. Unknown wizard fields are ignored (never trusted, never stored).
export const OnboardingDraftSchema = z.object({
  slug: z.string().trim().toLowerCase().min(1, "Business link is missing."),
  step: z.number().int().min(1).max(10),
  data: z
    .object({
      businessName: z.string().trim().max(80).optional(),
      address: z.string().trim().max(200).optional(),
      currency: z.string().trim().max(8).optional(),
      timezone: z.string().trim().max(64).optional(),
      phone: z.string().trim().max(20).optional(),
      branches: z.array(BranchDraftSchema).max(20).optional(),
    })
    .catchall(z.unknown()),
});

export type OnboardingDraft = z.infer<typeof OnboardingDraftSchema>;

export async function saveOnboardingDraft(
  userId: string,
  raw: unknown,
  requestIp?: string,
  db?: SupabaseClient,
): Promise<{ step: number }> {
  const parsed = OnboardingDraftSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? "Invalid onboarding data.");
  }
  const client = db ?? getSupabaseAdmin();
  const { slug, step, data } = parsed.data;

  try {
    const { tenant } = await getTenantBySlug(userId, slug, client);

    const settingsPatch: Record<string, string> = {};
    if (data.businessName) settingsPatch.business_name = data.businessName;
    if (data.address) settingsPatch.address = data.address;
    if (data.currency) settingsPatch.currency = data.currency;
    if (data.timezone) settingsPatch.timezone = data.timezone;
    if (Object.keys(settingsPatch).length > 0) {
      const { error } = await client
        .from("business_settings")
        .upsert({ tenant_id: tenant.id, ...settingsPatch }, { onConflict: "tenant_id" });
      if (error) throw error;
    }

    if (data.phone && /^\+255\d{9}$/.test(data.phone)) {
      const { error } = await client
        .from("tenants")
        .update({ phone_e164: data.phone })
        .eq("id", tenant.id);
      if (error) throw error;
    }

    if (data.branches && data.branches.length > 0) {
      const rows = data.branches.map((b) => ({
        tenant_id: tenant.id,
        name: b.name,
        ward: b.ward || null,
      }));
      const { error } = await client
        .from("branches")
        .upsert(rows, { onConflict: "tenant_id,name" });
      if (error) throw error;
    }

    await writeAudit(
      {
        tenantId: tenant.id,
        userId,
        action: "onboarding.draft_saved",
        entity: "tenant",
        entityId: tenant.id,
        metadata: { step },
        ip: requestIp,
      },
      { throwOnError: false },
      client,
    );

    return { step };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not save your progress"));
  }
}
