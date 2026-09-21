import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, humanizeDbError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/server/supabase-admin";
import { writeAudit } from "@/services/audit.service";
import { requirePermission } from "@/services/rbac.service";
import { mapTemplateParams, sendTemplateOutbound } from "@/services/whatsapp.service";

export const AUTOMATION_EVENTS = [
  "booking.confirmed",
  "booking.reminder",
  "quote.sent",
  "job.en_route",
  "job.arrived",
  "job.completed",
  "invoice.sent",
  "invoice.overdue",
  "payment.received",
] as const;

export type AutomationEvent = (typeof AUTOMATION_EVENTS)[number];

export interface AutomationRule {
  id: string;
  tenant_id: string;
  event: string;
  template_id: string | null;
  template_name: string | null;
  active: boolean;
}

export interface AutomationContext {
  phone?: string;
  customerId?: string;
  bookingReference?: string;
  params?: Record<string, string>;
}

export const UpsertRuleInputSchema = z.object({
  event: z.enum(AUTOMATION_EVENTS, { message: "Choose a valid automation event." }),
  templateId: z.uuid("Invalid template.").nullable().optional(),
  active: z.boolean().optional().default(true),
});

function dbOrAdmin(db?: SupabaseClient): SupabaseClient {
  return db ?? getSupabaseAdmin();
}

function checkIds(tenantId: string, userId: string): void {
  const parsed = z
    .object({ tenantId: z.uuid("Invalid business."), userId: z.uuid("Invalid user. Please sign in again.") })
    .safeParse({ tenantId, userId });
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request.");
}

function toRule(row: Record<string, unknown>): AutomationRule {
  const template = row.whatsapp_templates as { name?: unknown } | null;
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    event: String(row.event ?? ""),
    template_id: (row.template_id as string | null) ?? null,
    template_name: typeof template?.name === "string" ? template.name : null,
    active: Boolean(row.active ?? false),
  };
}

export async function listRules(
  tenantId: string,
  userId: string,
  db?: SupabaseClient,
): Promise<AutomationRule[]> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "whatsapp:read", db);
  const client = dbOrAdmin(db);
  try {
    const { data, error } = await client
      .from("whatsapp_automation_rules")
      .select("*, whatsapp_templates(name)")
      .eq("tenant_id", tenantId)
      .order("event", { ascending: true });
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map(toRule);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load automation rules"));
  }
}

export async function upsertRule(
  tenantId: string,
  userId: string,
  rawInput: unknown,
  db?: SupabaseClient,
): Promise<AutomationRule> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "whatsapp:templates", db);
  const parsed = UpsertRuleInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check the rule and try again.");
  const client = dbOrAdmin(db);
  try {
    if (parsed.data.templateId) {
      const { data: template, error: templateError } = await client
        .from("whatsapp_templates")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("id", parsed.data.templateId)
        .maybeSingle();
      if (templateError) throw templateError;
      if (!template) throw new AppError("The selected template could not be found.");
    }
    const { data: existing, error: readError } = await client
      .from("whatsapp_automation_rules")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("event", parsed.data.event)
      .maybeSingle();
    if (readError) throw readError;
    let row: Record<string, unknown>;
    if (existing) {
      const { data, error } = await client
        .from("whatsapp_automation_rules")
        .update({
          template_id: parsed.data.templateId ?? null,
          active: parsed.data.active,
        })
        .eq("tenant_id", tenantId)
        .eq("id", String((existing as Record<string, unknown>).id))
        .select("*, whatsapp_templates(name)")
        .single();
      if (error) throw error;
      row = data as Record<string, unknown>;
    } else {
      const { data, error } = await client
        .from("whatsapp_automation_rules")
        .insert({
          tenant_id: tenantId,
          event: parsed.data.event,
          template_id: parsed.data.templateId ?? null,
          active: parsed.data.active,
        })
        .select("*, whatsapp_templates(name)")
        .single();
      if (error) throw error;
      row = data as Record<string, unknown>;
    }
    const rule = toRule(row);
    await writeAudit(
      { tenantId, userId, action: "whatsapp.rule_saved", entity: "whatsapp_automation_rule", entityId: rule.id, metadata: { event: rule.event, active: rule.active } },
      { throwOnError: false },
      client,
    );
    return rule;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not save this automation rule"));
  }
}

/**
 * Best-effort automation fan-out. Never throws: every failure is swallowed
 * after a best-effort audit so the caller's main flow always survives.
 * Usage limits still apply (automated messages count), so a tenant over its
 * plan quota simply skips the send.
 */
export async function triggerAutomationEvent(
  tenantId: string,
  event: string,
  context: AutomationContext = {},
  db?: SupabaseClient,
): Promise<{ sent: boolean; reason?: string }> {
  try {
    if (!tenantId || !(AUTOMATION_EVENTS as readonly string[]).includes(event)) {
      return { sent: false, reason: "unknown-event" };
    }
    const client = dbOrAdmin(db);

    const { data: ruleRow, error: ruleError } = await client
      .from("whatsapp_automation_rules")
      .select("id, template_id")
      .eq("tenant_id", tenantId)
      .eq("event", event)
      .eq("active", true)
      .maybeSingle();
    if (ruleError || !ruleRow) return { sent: false, reason: "no-rule" };
    const templateId = (ruleRow as Record<string, unknown>).template_id as string | null;
    if (!templateId) return { sent: false, reason: "no-template" };

    const { data: templateRow, error: templateError } = await client
      .from("whatsapp_templates")
      .select("name, language, body, variables, status")
      .eq("tenant_id", tenantId)
      .eq("id", templateId)
      .maybeSingle();
    if (templateError || !templateRow) return { sent: false, reason: "no-template" };
    const template = templateRow as Record<string, unknown>;
    if (template.status !== "APPROVED") return { sent: false, reason: "not-approved" };

    // Resolve the recipient: explicit phone wins, then the customer lookup.
    let phone = (context.phone ?? "").trim();
    if (!phone && context.customerId) {
      const { data: customer } = await client
        .from("customers")
        .select("phone_e164")
        .eq("tenant_id", tenantId)
        .eq("id", context.customerId)
        .is("deleted_at", null)
        .maybeSingle();
      const found = (customer as { phone_e164?: unknown } | null)?.phone_e164;
      if (typeof found === "string") phone = found;
    }
    if (!phone) return { sent: false, reason: "no-phone" };

    // Render params in template variable order; sources resolve from
    // context.params and bookingReference, missing -> ''.
    const rawVars = Array.isArray(template.variables)
      ? (template.variables as Array<{ position?: unknown; source?: unknown }>)
      : [];
    const paramsBag: Record<string, string> = { ...(context.params ?? {}) };
    if (context.bookingReference && !paramsBag.bookingReference) {
      paramsBag.bookingReference = context.bookingReference;
    }
    const ordered = rawVars
      .filter((v) => typeof v.position === "number" && typeof v.source === "string")
      .map((v) => ({ position: Number(v.position), source: String(v.source) }));
    const params = mapTemplateParams(ordered, paramsBag);

    await sendTemplateOutbound(
      tenantId,
      {
        phone,
        templateName: String(template.name ?? ""),
        language: String(template.language ?? "sw"),
        params,
        sentBy: null,
      },
      client,
    );

    return { sent: true };
  } catch {
    return { sent: false, reason: "error" };
  }
}
