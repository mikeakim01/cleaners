import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, humanizeDbError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/server/supabase-admin";

export const WriteAuditInputSchema = z.object({
  tenantId: z.string().uuid("Invalid business. Please reload and try again."),
  userId: z.string().uuid("Invalid user. Please sign in again."),
  action: z.string().trim().min(2, "Audit action is required.").max(80),
  entity: z.string().trim().min(2, "Audit entity is required.").max(60),
  // audit_logs.entity_id is uuid — every audited record (tenant, booking, …) uses uuid ids.
  entityId: z.string().uuid("Audit record reference must be a valid id."),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
  ip: z.string().trim().max(64).optional(),
});

export type WriteAuditInput = z.infer<typeof WriteAuditInputSchema>;

export async function writeAudit(
  rawInput: unknown,
  opts: { throwOnError?: boolean } = {},
  db?: SupabaseClient,
): Promise<void> {
  const { throwOnError = true } = opts;
  const parsed = WriteAuditInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    if (!throwOnError) return;
    throw new AppError(parsed.error.issues[0]?.message ?? "Could not record this activity.");
  }
  try {
    const client = db ?? getSupabaseAdmin();
    const { error } = await client.from("audit_logs").insert({
      tenant_id: parsed.data.tenantId,
      user_id: parsed.data.userId,
      action: parsed.data.action,
      entity: parsed.data.entity,
      entity_id: parsed.data.entityId,
      metadata: parsed.data.metadata,
      ip: parsed.data.ip ?? null,
    });
    if (error) throw error;
  } catch (err) {
    if (!throwOnError) return;
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not record this activity"));
  }
}
