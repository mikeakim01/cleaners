/**
 * Service-to-display mappers for WhatsApp (Phase 4).
 * Services speak snake_case + UPPER statuses; UI (wa-types) speaks
 * camelCase. All mapping lives here — never in components.
 */
import type {
  WaAccount,
  WaAccountStatus,
  WaAutomationRule,
  WaConversation,
  WaMessage,
  WaTemplate,
} from "./wa-types";
import type {
  WhatsAppAccount,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppTemplate,
} from "@/services/whatsapp.service";
import type { AutomationRule } from "@/services/whatsapp-automations.service";

const ACCOUNT_STATUSES: readonly string[] = [
  "CONNECTED",
  "PENDING",
  "DISCONNECTED",
  "ERROR",
];

export function mapAccount(a: WhatsAppAccount): WaAccount {
  const status: WaAccountStatus = ACCOUNT_STATUSES.includes(a.status)
    ? (a.status as WaAccountStatus)
    : "DISCONNECTED";
  return {
    id: a.id,
    phoneNumberId: a.phone_number_id,
    wabaId: a.waba_id,
    displayName: a.display_name,
    phone: null,
    status,
    hasToken: status !== "DISCONNECTED",
    lastTestedAt: a.last_tested_at,
  };
}

export function mapConversation(c: WhatsAppConversation): WaConversation {
  return {
    id: c.id,
    phoneE164: c.phone_e164,
    customerName: c.customer_name ?? null,
    // BLOCKED threads behave as finished work in the inbox filter.
    status: c.status === "OPEN" ? "OPEN" : "RESOLVED",
    unreadCount: c.unread_count,
    lastMessageAt: c.last_message_at,
    lastBody: c.last_body ?? null,
  };
}

export function mapMessage(m: WhatsAppMessage): WaMessage {
  const direction = m.direction === "outbound" ? "outbound" : "inbound";
  const status =
    m.status === "sent" ||
    m.status === "delivered" ||
    m.status === "read" ||
    m.status === "failed"
      ? m.status
      : null;
  return {
    id: m.id,
    direction,
    kind: m.kind === "template" ? "template" : "text",
    body: m.body ?? "",
    templateName: m.template_name,
    status,
    createdAt: m.created_at,
  };
}

const TEMPLATE_STATUSES = ["DRAFT", "APPROVED", "PENDING", "REJECTED"] as const;

export function mapTemplate(t: WhatsAppTemplate): WaTemplate {
  return {
    id: t.id,
    name: t.name,
    language: t.language,
    category: t.category,
    body: t.body,
    variables: [...t.variables]
      .sort((a, b) => a.position - b.position)
      .map((v) => v.source),
    status: (TEMPLATE_STATUSES as readonly string[]).includes(t.status)
      ? (t.status as WaTemplate["status"])
      : "DRAFT",
  };
}

/** UI variable sources -> service [{position, source}] (order = position). */
export function toServiceVariables(sources: string[]): Array<{
  position: number;
  source: string;
}> {
  return sources
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((source, i) => ({ position: i + 1, source }));
}

export function mapRule(r: AutomationRule): WaAutomationRule {
  return { event: r.event, templateId: r.template_id, active: r.active };
}
