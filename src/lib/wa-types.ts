/**
 * WhatsApp display types (Phase 4).
 * UI-facing camelCase shapes; service-to-UI mapping lives in wa-mappers.ts.
 * No business rules here.
 */

export type WaActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type WaAccountStatus = "CONNECTED" | "PENDING" | "DISCONNECTED" | "ERROR";

export interface WaAccount {
  id: string;
  phoneNumberId: string;
  wabaId: string;
  displayName: string | null;
  phone: string | null;
  status: WaAccountStatus;
  hasToken: boolean;
  lastTestedAt: string | null;
}

export interface WaConnectInput {
  phoneNumberId: string;
  wabaId: string;
  displayName?: string;
  accessToken: string;
}

export interface WaConversationFilters {
  search?: string;
  status?: "OPEN" | "RESOLVED";
}

export interface WaConversation {
  id: string;
  phoneE164: string;
  customerName: string | null;
  status: "OPEN" | "RESOLVED";
  unreadCount: number;
  lastMessageAt: string | null;
  lastBody: string | null;
}

export interface WaMessage {
  id: string;
  direction: "inbound" | "outbound";
  kind: "text" | "template";
  body: string;
  templateName: string | null;
  status: "sent" | "delivered" | "read" | "failed" | null;
  createdAt: string;
}

export interface WaTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  body: string;
  variables: string[];
  status: "DRAFT" | "APPROVED" | "PENDING" | "REJECTED";
}

export interface WaCreateTemplateInput {
  name: string;
  language: string;
  category: string;
  body: string;
  variables: string[];
}

export interface WaUpdateTemplateInput {
  id: string;
  status?: WaTemplate["status"];
  variables?: string[];
}

export interface WaAutomationRule {
  event: string;
  templateId: string | null;
  active: boolean;
}

export interface WaUpsertRuleInput {
  event: string;
  templateId: string | null;
  active: boolean;
}
