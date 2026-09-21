import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, humanizeDbError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/server/supabase-admin";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import {
  getBusinessProfile as cloudGetBusinessProfile,
  sendTemplateMessage as cloudSendTemplate,
  sendTextMessage as cloudSendText,
} from "@/server/whatsapp/cloud-api";
import { writeAudit } from "@/services/audit.service";
import { requirePermission } from "@/services/rbac.service";
import { assertWithinLimits } from "@/services/subscriptions.service";

/* ------------------------------------------------------------------ */
/* Pure helpers (unit-tested, no I/O)                                   */
/* ------------------------------------------------------------------ */

/** Strip everything but digits, then prepend '+'. "255 712-345-678" -> "+255712345678". */
export function normalizeWaPhone(waId: string): string {
  const digits = (waId ?? "").replace(/\D/g, "");
  return `+${digits}`;
}

/** Normalize a locally entered phone: strip spaces/dashes, ensure a leading '+'. */
export function normalizePhoneInput(phone: string): string {
  const cleaned = (phone ?? "").replace(/[\s\-().]/g, "").trim();
  if (!cleaned) return "";
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

/** Replace {{1}}, {{2}}, … with params (1-based). Missing -> '', extras ignored. */
export function renderTemplate(body: string, params: readonly string[]): string {
  return (body ?? "").replace(/\{\{(\d+)\}\}/g, (_match, raw: string) => {
    const idx = Number.parseInt(raw, 10) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= params.length) return "";
    return params[idx] ?? "";
  });
}

export interface TemplateVariable {
  position: number;
  source: string;
}

/**
 * Pure variable mapping: sort template variables by position, resolve each
 * source key from the params bag, missing -> ''. Extra bag keys ignored.
 */
export function mapTemplateParams(
  variables: readonly TemplateVariable[],
  params: Record<string, string>,
): string[] {
  return [...variables]
    .filter((v) => typeof v.position === "number" && typeof v.source === "string")
    .sort((a, b) => a.position - b.position)
    .map((v) => params[v.source] ?? "");
}

/**
 * Verify a Meta webhook signature: HMAC-SHA256 hex of the raw body.
 * Accepts the 'sha256=…' prefix. False on missing/mismatched values.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  appSecret: string,
): boolean {
  if (!rawBody || !signatureHeader || !appSecret) return false;
  const provided = signatureHeader.startsWith("sha256=") ? signatureHeader.slice(7) : signatureHeader;
  if (!/^[0-9a-fA-F]+$/.test(provided)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(provided.toLowerCase(), "utf8");
  const b = Buffer.from(expected.toLowerCase(), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const INBOUND_KINDS = [
  "text",
  "template",
  "image",
  "audio",
  "document",
  "contacts",
  "location",
  "reaction",
  "unknown",
] as const;
export type WhatsAppMessageKind = (typeof INBOUND_KINDS)[number];

const KNOWN_INBOUND_TYPES: ReadonlySet<string> = new Set(INBOUND_KINDS);

export interface ParsedInboundMessage {
  wabaId: string;
  from: string;
  kind: WhatsAppMessageKind;
  body: string;
  timestamp: string | null;
}

export interface ParsedStatusUpdate {
  wabaId: string;
  status: string;
  timestamp: string | null;
  recipient: string;
}

export interface ParsedWebhook {
  phoneNumberId: string;
  messages: ParsedInboundMessage[];
  statuses: ParsedStatusUpdate[];
}

function textOrCaption(v: unknown): string {
  if (typeof v === "object" && v !== null) {
    const body = (v as { body?: unknown }).body;
    if (typeof body === "string") return body;
    const caption = (v as { caption?: unknown }).caption;
    if (typeof caption === "string") return caption;
  }
  return "";
}

function messageBodyOf(type: string, msg: Record<string, unknown>): string {
  switch (type) {
    case "text":
      return textOrCaption(msg.text);
    case "image":
    case "audio":
    case "video":
    case "document":
    case "sticker":
      return textOrCaption(msg[type]);
    case "location": {
      const loc = msg.location as { latitude?: unknown; longitude?: unknown; name?: unknown } | undefined;
      if (!loc) return "";
      return [loc.latitude, loc.longitude].every((v) => v !== undefined) ? `${loc.latitude},${loc.longitude}` : "";
    }
    case "contacts": {
      const first = (msg.contacts as Array<{ name?: { formatted_name?: unknown } }> | undefined)?.[0];
      return typeof first?.name?.formatted_name === "string" ? first.name.formatted_name : "";
    }
    case "reaction":
      return typeof (msg.reaction as { emoji?: unknown } | undefined)?.emoji === "string"
        ? String((msg.reaction as { emoji: string }).emoji)
        : "";
    default:
      return "";
  }
}

/**
 * Parse a Meta WhatsApp webhook payload. Never throws: unknown message
 * types become kind 'unknown' with body '', unknown shapes are ignored.
 * Aggregates across every entry/change (multi-entry safe).
 */
export function parseWebhookPayload(payload: unknown): ParsedWebhook {
  const out: ParsedWebhook = { phoneNumberId: "", messages: [], statuses: [] };
  if (typeof payload !== "object" || payload === null) return out;
  const entries = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const changes = (entry as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      if (typeof change !== "object" || change === null) continue;
      const value = (change as { value?: unknown }).value;
      if (typeof value !== "object" || value === null) continue;
      const v = value as Record<string, unknown>;
      const metadata = v.metadata as { phone_number_id?: unknown } | undefined;
      const phoneNumberId =
        typeof metadata?.phone_number_id === "string" ? metadata.phone_number_id : "";
      if (phoneNumberId && !out.phoneNumberId) out.phoneNumberId = phoneNumberId;

      const rawMessages = v.messages;
      if (Array.isArray(rawMessages)) {
        for (const raw of rawMessages) {
          if (typeof raw !== "object" || raw === null) continue;
          const m = raw as Record<string, unknown>;
          const wabaId = typeof m.id === "string" ? m.id : "";
          const from = typeof m.from === "string" ? m.from : "";
          if (!wabaId || !from) continue;
          const rawType = typeof m.type === "string" ? m.type : "";
          const kind: WhatsAppMessageKind = KNOWN_INBOUND_TYPES.has(rawType)
            ? (rawType as WhatsAppMessageKind)
            : "unknown";
          out.messages.push({
            wabaId,
            from,
            kind,
            body: kind === "unknown" ? "" : messageBodyOf(rawType, m),
            timestamp: typeof m.timestamp === "string" ? m.timestamp : null,
          });
        }
      }

      const rawStatuses = v.statuses;
      if (Array.isArray(rawStatuses)) {
        for (const raw of rawStatuses) {
          if (typeof raw !== "object" || raw === null) continue;
          const s = raw as Record<string, unknown>;
          const wabaId = typeof s.id === "string" ? s.id : "";
          const status = typeof s.status === "string" ? s.status : "";
          if (!wabaId || !status) continue;
          out.statuses.push({
            wabaId,
            status,
            timestamp: typeof s.timestamp === "string" ? s.timestamp : null,
            recipient: typeof s.recipient_id === "string" ? s.recipient_id : "",
          });
        }
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* WhatsApp Cloud API (shared client in @/server/whatsapp/cloud-api)  */
/* ------------------------------------------------------------------ */

const CONNECT_HELP = "Connect WhatsApp Business first (Settings > WhatsApp).";

/** Verify credentials against the Cloud API business-profile endpoint. */
async function getBusinessProfile(phoneNumberId: string, token: string): Promise<void> {
  await cloudGetBusinessProfile({ phoneNumberId, token });
}

async function sendTextViaApi(
  phoneNumberId: string,
  token: string,
  to: string,
  body: string,
): Promise<string> {
  const { messageId } = await cloudSendText({ phoneNumberId, token, to, body });
  return messageId;
}

async function sendTemplateViaApi(
  phoneNumberId: string,
  token: string,
  to: string,
  templateName: string,
  language: string,
  params: readonly string[],
): Promise<string> {
  const { messageId } = await cloudSendTemplate({
    phoneNumberId,
    token,
    to,
    templateName,
    language,
    templateParams: [...params],
  });
  return messageId;
}

/* ------------------------------------------------------------------ */
/* Row types + validation                                               */
/* ------------------------------------------------------------------ */

export const ACCOUNT_STATUSES = ["DISCONNECTED", "PENDING", "CONNECTED", "ERROR"] as const;
export const TEMPLATE_STATUSES = ["DRAFT", "PENDING", "APPROVED", "REJECTED"] as const;
export const TEMPLATE_CATEGORIES = ["UTILITY", "MARKETING", "AUTHENTICATION"] as const;
export const CONVERSATION_STATUSES = ["OPEN", "RESOLVED", "BLOCKED"] as const;

export interface WhatsAppAccount {
  id: string;
  tenant_id: string;
  phone_number_id: string;
  display_name: string | null;
  waba_id: string;
  status: string;
  last_tested_at: string | null;
  webhook_subscribed: boolean;
}

export interface WhatsAppConversation {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  phone_e164: string;
  status: string;
  assigned_user_id: string | null;
  last_message_at: string | null;
  unread_count: number;
  /** Joined display fields (present on list/thread loads). */
  customer_name?: string | null;
  last_body?: string | null;
}

export interface WhatsAppMessage {
  id: string;
  tenant_id: string;
  conversation_id: string;
  waba_message_id: string | null;
  kind: string;
  direction: string;
  body: string | null;
  template_name: string | null;
  template_params: unknown;
  status: string;
  error: string | null;
  sent_by: string | null;
  created_at: string;
}

export interface WhatsAppTemplate {
  id: string;
  tenant_id: string;
  name: string;
  language: string;
  category: string;
  body: string;
  variables: Array<{ position: number; source: string }>;
  status: string;
  meta_template_id: string | null;
}

export const ConnectAccountInputSchema = z.object({
  phoneNumberId: z.string().trim().min(1, "Phone number ID is required.").max(64),
  wabaId: z.string().trim().min(1, "WhatsApp Business account ID is required.").max(64),
  displayName: z.string().trim().max(120).optional().default(""),
  accessToken: z.string().trim().min(1, "Access token is required.").max(2000),
});

export const SendTextInputSchema = z.object({
  conversationId: z.uuid("Invalid conversation.").optional(),
  phone: z.string().trim().max(32).optional(),
  body: z.string().trim().min(1, "Type a message first.").max(4096, "Messages are limited to 4096 characters."),
});

export const SendTemplateInputSchema = z.object({
  conversationId: z.uuid("Invalid conversation.").optional(),
  phone: z.string().trim().max(32).optional(),
  templateName: z.string().trim().min(1, "Choose a template.").max(120),
  params: z.array(z.string().max(1024)).max(20).optional().default([]),
});

export const CreateTemplateInputSchema = z.object({
  name: z
    .string().trim().toLowerCase().min(1, "Template name is required.")
    .max(120)
    .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers and underscores only."),
  language: z.string().trim().min(2, "Language is required.").max(16).default("sw"),
  category: z.enum(TEMPLATE_CATEGORIES, { message: "Choose a valid template category." }),
  body: z.string().trim().min(1, "Template body is required.").max(1024),
  variables: z
    .array(z.object({ position: z.number().int().positive(), source: z.string().trim().min(1).max(80) }))
    .max(20)
    .optional()
    .default([]),
});

export const UpdateTemplateInputSchema = z.object({
  body: z.string().trim().min(1, "Template body is required.").max(1024).optional(),
  variables: z
    .array(z.object({ position: z.number().int().positive(), source: z.string().trim().min(1).max(80) }))
    .max(20)
    .optional(),
  status: z.enum(TEMPLATE_STATUSES, { message: "Choose a valid template status." }).optional(),
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

function toAccount(r: Record<string, unknown>): WhatsAppAccount {
  return {
    id: String(r.id),
    tenant_id: String(r.tenant_id),
    phone_number_id: String(r.phone_number_id ?? ""),
    display_name: (r.display_name as string | null) ?? null,
    waba_id: String(r.waba_id ?? ""),
    status: String(r.status ?? "DISCONNECTED"),
    last_tested_at: (r.last_tested_at as string | null) ?? null,
    webhook_subscribed: Boolean(r.webhook_subscribed ?? false),
  };
}

function toConversation(r: Record<string, unknown>): WhatsAppConversation {
  const customer = r.customers as { full_name?: unknown } | null;
  return {
    id: String(r.id),
    tenant_id: String(r.tenant_id),
    customer_id: (r.customer_id as string | null) ?? null,
    phone_e164: String(r.phone_e164 ?? ""),
    status: String(r.status ?? "OPEN"),
    assigned_user_id: (r.assigned_user_id as string | null) ?? null,
    last_message_at: (r.last_message_at as string | null) ?? null,
    unread_count: Number(r.unread_count ?? 0),
    customer_name:
      typeof customer?.full_name === "string" ? customer.full_name : null,
    last_body:
      typeof r.last_body === "string" ? (r.last_body as string) : null,
  };
}

/** Attach customer names + latest message snippets to conversation rows. */
async function enrichConversations(
  client: SupabaseClient,
  tenantId: string,
  rows: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return rows;
  const ids = rows.map((r) => String(r.id));
  const { data: recent } = await client
    .from("whatsapp_messages")
    .select("conversation_id, body, created_at")
    .eq("tenant_id", tenantId)
    .in("conversation_id", ids)
    .order("created_at", { ascending: false })
    .limit(1000);
  const lastBody = new Map<string, string>();
  for (const m of ((recent ?? []) as Array<Record<string, unknown>>)) {
    const cid = String(m.conversation_id ?? "");
    if (cid && !lastBody.has(cid) && typeof m.body === "string") {
      lastBody.set(cid, m.body);
    }
  }
  return rows.map((r) => ({
    ...r,
    last_body: lastBody.get(String(r.id)) ?? null,
  }));
}

function toMessage(r: Record<string, unknown>): WhatsAppMessage {
  return {
    id: String(r.id),
    tenant_id: String(r.tenant_id),
    conversation_id: String(r.conversation_id ?? ""),
    waba_message_id: (r.waba_message_id as string | null) ?? null,
    kind: String(r.kind ?? "text"),
    direction: String(r.direction ?? "outbound"),
    body: (r.body as string | null) ?? null,
    template_name: (r.template_name as string | null) ?? null,
    template_params: r.template_params ?? null,
    status: String(r.status ?? "queued"),
    error: (r.error as string | null) ?? null,
    sent_by: (r.sent_by as string | null) ?? null,
    created_at: String(r.created_at ?? ""),
  };
}

function toTemplate(r: Record<string, unknown>): WhatsAppTemplate {
  const rawVars = Array.isArray(r.variables) ? (r.variables as Array<Record<string, unknown>>) : [];
  return {
    id: String(r.id),
    tenant_id: String(r.tenant_id),
    name: String(r.name ?? ""),
    language: String(r.language ?? "sw"),
    category: String(r.category ?? "UTILITY"),
    body: String(r.body ?? ""),
    variables: rawVars
      .filter((v) => typeof v.position === "number" && typeof v.source === "string")
      .map((v) => ({ position: Number(v.position), source: String(v.source) })),
    status: String(r.status ?? "DRAFT"),
    meta_template_id: (r.meta_template_id as string | null) ?? null,
  };
}

async function loadAccount(
  client: SupabaseClient,
  tenantId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await client
    .from("whatsapp_accounts")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw error;
  return (data as Record<string, unknown> | null) ?? null;
}

async function loadConnectedAccount(
  client: SupabaseClient,
  tenantId: string,
): Promise<Record<string, unknown>> {
  const account = await loadAccount(client, tenantId);
  if (!account || account.status !== "CONNECTED") {
    throw new AppError(CONNECT_HELP);
  }
  return account;
}

/* ------------------------------------------------------------------ */
/* Account lifecycle                                                    */
/* ------------------------------------------------------------------ */

export async function connectAccount(
  tenantId: string,
  userId: string,
  rawInput: unknown,
  db?: SupabaseClient,
): Promise<WhatsAppAccount> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "whatsapp:connect", db);
  const parsed = ConnectAccountInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check the WhatsApp details and try again.");
  const input = parsed.data;
  const client = dbOrAdmin(db);

  try {
    const accessTokenEnc = await encryptSecret(input.accessToken);
    try {
      await getBusinessProfile(input.phoneNumberId, input.accessToken);
    } catch {
      await client.from("whatsapp_accounts").upsert(
        {
          tenant_id: tenantId,
          phone_number_id: input.phoneNumberId,
          display_name: input.displayName || null,
          waba_id: input.wabaId,
          access_token_enc: accessTokenEnc,
          status: "ERROR",
        },
        { onConflict: "tenant_id" },
      );
      throw new AppError("WhatsApp rejected these credentials. Check the phone number ID and token.");
    }

    const { data, error } = await client
      .from("whatsapp_accounts")
      .upsert(
        {
          tenant_id: tenantId,
          phone_number_id: input.phoneNumberId,
          display_name: input.displayName || null,
          waba_id: input.wabaId,
          access_token_enc: accessTokenEnc,
          status: "CONNECTED",
          last_tested_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id" },
      )
      .select()
      .single();
    if (error) throw error;
    const account = toAccount(data as Record<string, unknown>);
    await writeAudit(
      { tenantId, userId, action: "whatsapp.connected", entity: "whatsapp_account", entityId: account.id, metadata: { phoneNumberId: input.phoneNumberId } },
      { throwOnError: false },
      client,
    );
    return account;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not connect WhatsApp"));
  }
}

export async function testConnection(
  tenantId: string,
  userId: string,
  db?: SupabaseClient,
): Promise<WhatsAppAccount> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "whatsapp:read", db);
  const client = dbOrAdmin(db);

  try {
    const account = await loadAccount(client, tenantId);
    if (!account) throw new AppError(CONNECT_HELP);
    let token: string;
    try {
      token = await decryptSecret(String(account.access_token_enc ?? ""));
    } catch {
      throw new AppError("The stored WhatsApp token cannot be read. Reconnect WhatsApp to continue.");
    }
    let status: string = "CONNECTED";
    try {
      await getBusinessProfile(String(account.phone_number_id ?? ""), token);
    } catch {
      status = "ERROR";
    }
    const { data, error } = await client
      .from("whatsapp_accounts")
      .update({
        status,
        last_tested_at: status === "CONNECTED" ? new Date().toISOString() : account.last_tested_at ?? null,
      })
      .eq("tenant_id", tenantId)
      .eq("id", String(account.id))
      .select()
      .single();
    if (error) throw error;
    const updated = toAccount(data as Record<string, unknown>);
    if (status !== "CONNECTED") {
      throw new AppError("WhatsApp rejected these credentials. Check the phone number ID and token.");
    }
    return updated;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not test the WhatsApp connection"));
  }
}

export async function disconnectAccount(
  tenantId: string,
  userId: string,
  db?: SupabaseClient,
): Promise<WhatsAppAccount> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "whatsapp:connect", db);
  const client = dbOrAdmin(db);

  try {
    const account = await loadAccount(client, tenantId);
    if (!account) throw new AppError(CONNECT_HELP);
    const { data, error } = await client
      .from("whatsapp_accounts")
      .update({ access_token_enc: "", status: "DISCONNECTED" })
      .eq("tenant_id", tenantId)
      .eq("id", String(account.id))
      .select()
      .single();
    if (error) throw error;
    const updated = toAccount(data as Record<string, unknown>);
    await writeAudit(
      { tenantId, userId, action: "whatsapp.disconnected", entity: "whatsapp_account", entityId: updated.id, metadata: {} },
      { throwOnError: false },
      client,
    );
    return updated;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not disconnect WhatsApp"));
  }
}

export async function getAccount(
  tenantId: string,
  userId: string,
  db?: SupabaseClient,
): Promise<WhatsAppAccount | null> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "whatsapp:read", db);
  const client = dbOrAdmin(db);
  try {
    const account = await loadAccount(client, tenantId);
    return account ? toAccount(account) : null;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load the WhatsApp connection"));
  }
}

/* ------------------------------------------------------------------ */
/* Conversations + threads                                              */
/* ------------------------------------------------------------------ */

/** Find-or-create a conversation for a phone number (no permission gate — used by ingest too). */
export async function resolveConversation(
  tenantId: string,
  phone: string,
  customerId?: string | null,
  db?: SupabaseClient,
): Promise<WhatsAppConversation> {
  const phoneE164 = normalizePhoneInput(phone);
  if (!phoneE164) throw new AppError("A valid phone number is required.");
  const client = dbOrAdmin(db);
  try {
    const { data: existing, error: readError } = await client
      .from("whatsapp_conversations")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("phone_e164", phoneE164)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (readError) throw readError;
    if (existing) {
      const row = existing as Record<string, unknown>;
      if (customerId && !row.customer_id) {
        const { data: patched, error: patchError } = await client
          .from("whatsapp_conversations")
          .update({ customer_id: customerId })
          .eq("tenant_id", tenantId)
          .eq("id", String(row.id))
          .select()
          .single();
        if (patchError) throw patchError;
        return toConversation(patched as Record<string, unknown>);
      }
      return toConversation(row);
    }
    const { data, error } = await client
      .from("whatsapp_conversations")
      .insert({
        tenant_id: tenantId,
        customer_id: customerId ?? null,
        phone_e164: phoneE164,
        status: "OPEN",
        unread_count: 0,
      })
      .select()
      .single();
    if (error) throw error;
    return toConversation(data as Record<string, unknown>);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not open this conversation"));
  }
}

async function resolveTargetConversation(
  client: SupabaseClient,
  tenantId: string,
  input: { conversationId?: string; phone?: string },
): Promise<WhatsAppConversation> {
  if (input.conversationId) {
    const { data, error } = await client
      .from("whatsapp_conversations")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", input.conversationId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new AppError("We could not find that conversation.");
    return toConversation(data as Record<string, unknown>);
  }
  const phone = (input.phone ?? "").trim();
  if (!phone) throw new AppError("Choose a conversation or enter a phone number.");
  return resolveConversation(tenantId, phone, null, client);
}

export async function listConversations(
  tenantId: string,
  userId: string,
  rawFilter: unknown = {},
  db?: SupabaseClient,
): Promise<WhatsAppConversation[]> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "whatsapp:read", db);
  const parsed = z.object({ status: z.enum(CONVERSATION_STATUSES).optional() }).safeParse(rawFilter ?? {});
  if (!parsed.success) throw new AppError("Invalid filter.");
  const client = dbOrAdmin(db);
  try {
    let query = client
      .from("whatsapp_conversations")
      .select("*, customers(full_name)")
      .eq("tenant_id", tenantId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (parsed.data.status) query = query.eq("status", parsed.data.status);
    const { data, error } = await query;
    if (error) throw error;
    const enriched = await enrichConversations(
      client,
      tenantId,
      ((data ?? []) as Record<string, unknown>[]),
    );
    return enriched.map(toConversation);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load conversations"));
  }
}

export async function getThread(
  tenantId: string,
  userId: string,
  conversationId: string,
  db?: SupabaseClient,
): Promise<{ conversation: WhatsAppConversation; messages: WhatsAppMessage[] }> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "whatsapp:read", db);
  const idParsed = z.uuid("Invalid conversation.").safeParse(conversationId);
  if (!idParsed.success) throw new AppError("Invalid conversation.");
  const client = dbOrAdmin(db);
  try {
    const { data: conv, error: convError } = await client
      .from("whatsapp_conversations")
      .select("*, customers(full_name)")
      .eq("tenant_id", tenantId)
      .eq("id", conversationId)
      .maybeSingle();
    if (convError) throw convError;
    if (!conv) throw new AppError("We could not find that conversation.");
    const { data: rows, error: msgError } = await client
      .from("whatsapp_messages")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (msgError) throw msgError;
    return {
      conversation: toConversation(conv as Record<string, unknown>),
      messages: ((rows ?? []) as Record<string, unknown>[]).map(toMessage),
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load this conversation"));
  }
}

/* ------------------------------------------------------------------ */
/* Outbound pipeline (shared by user sends + automation triggers)       */
/* ------------------------------------------------------------------ */

export interface OutboundTemplateSend {
  phone: string;
  templateName: string;
  language: string;
  params: string[];
  sentBy: string | null;
  conversationId?: string;
}

async function decryptAccountToken(account: Record<string, unknown>): Promise<string> {
  try {
    return await decryptSecret(String(account.access_token_enc ?? ""));
  } catch {
    throw new AppError("The stored WhatsApp token cannot be read. Reconnect WhatsApp to continue.");
  }
}

async function insertOutboundRow(
  client: SupabaseClient,
  tenantId: string,
  conversation: WhatsAppConversation,
  row: {
    kind: string;
    body: string | null;
    templateName: string | null;
    templateParams: unknown;
    sentBy: string | null;
    wabaId: string | null;
    status: string;
    error: string | null;
  },
): Promise<WhatsAppMessage> {
  const { data, error } = await client
    .from("whatsapp_messages")
    .insert({
      tenant_id: tenantId,
      conversation_id: conversation.id,
      waba_message_id: row.wabaId,
      kind: row.kind,
      direction: "outbound",
      body: row.body,
      template_name: row.templateName,
      template_params: row.templateParams,
      status: row.status,
      error: row.error,
      sent_by: row.sentBy,
    })
    .select()
    .single();
  if (error) throw error;
  await client
    .from("whatsapp_conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", conversation.id);
  return toMessage(data as Record<string, unknown>);
}

export async function sendTextMessage(
  tenantId: string,
  userId: string,
  rawInput: unknown,
  db?: SupabaseClient,
): Promise<WhatsAppMessage> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "whatsapp:send", db);
  const parsed = SendTextInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check the message and try again.");
  const input = parsed.data;
  const client = dbOrAdmin(db);
  await assertWithinLimits(tenantId, "whatsappMessages", client);

  try {
    const account = await loadConnectedAccount(client, tenantId);
    const conversation = await resolveTargetConversation(client, tenantId, input);
    const token = await decryptAccountToken(account);
    let wabaId: string | null = null;
    let status = "sent";
    let sendError: string | null = null;
    try {
      wabaId = await sendTextViaApi(
        String(account.phone_number_id),
        token,
        conversation.phone_e164,
        input.body,
      );
    } catch (err) {
      status = "failed";
      sendError = err instanceof Error ? err.message : "WhatsApp could not send this message.";
    }
    const message = await insertOutboundRow(client, tenantId, conversation, {
      kind: "text",
      body: input.body,
      templateName: null,
      templateParams: null,
      sentBy: userId,
      wabaId,
      status,
      error: sendError,
    });
    await writeAudit(
      { tenantId, userId, action: "whatsapp.message_sent", entity: "whatsapp_message", entityId: message.id, metadata: { conversationId: conversation.id, status } },
      { throwOnError: false },
      client,
    );
    if (status === "failed") {
      throw new AppError(`WhatsApp could not send this message: ${sendError ?? "unknown error"}`);
    }
    return message;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not send this message"));
  }
}

async function loadApprovedTemplate(
  client: SupabaseClient,
  tenantId: string,
  templateName: string,
): Promise<WhatsAppTemplate> {
  const { data, error } = await client
    .from("whatsapp_templates")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("name", templateName.trim().toLowerCase())
    .maybeSingle();
  if (error) throw error;
  const row = (data as Record<string, unknown> | null) ?? null;
  if (!row || toTemplate(row).status !== "APPROVED") {
    throw new AppError("This template is not approved by Meta yet. Check Templates.");
  }
  return toTemplate(row);
}

/** Permission-free outbound template send used by automation triggers (limits still apply). */
export async function sendTemplateOutbound(
  tenantId: string,
  send: OutboundTemplateSend,
  db?: SupabaseClient,
): Promise<WhatsAppMessage> {
  const client = dbOrAdmin(db);
  await assertWithinLimits(tenantId, "whatsappMessages", client);
  try {
    const account = await loadConnectedAccount(client, tenantId);
    const template = await loadApprovedTemplate(client, tenantId, send.templateName);
    const conversation = send.conversationId
      ? await resolveTargetConversation(client, tenantId, { conversationId: send.conversationId })
      : await resolveConversation(tenantId, send.phone, null, client);
    const token = await decryptAccountToken(account);
    let wabaId: string | null = null;
    let status = "sent";
    let sendError: string | null = null;
    try {
      wabaId = await sendTemplateViaApi(
        String(account.phone_number_id),
        token,
        conversation.phone_e164,
        template.name,
        template.language,
        send.params,
      );
    } catch (err) {
      status = "failed";
      sendError = err instanceof Error ? err.message : "WhatsApp could not send this message.";
    }
    const message = await insertOutboundRow(client, tenantId, conversation, {
      kind: "template",
      body: renderTemplate(template.body, send.params),
      templateName: template.name,
      templateParams: send.params,
      sentBy: send.sentBy,
      wabaId,
      status,
      error: sendError,
    });
    if (send.sentBy) {
      await writeAudit(
        { tenantId, userId: send.sentBy, action: "whatsapp.message_sent", entity: "whatsapp_message", entityId: message.id, metadata: { conversationId: conversation.id, template: template.name, status } },
        { throwOnError: false },
        client,
      );
    }
    if (status === "failed") {
      throw new AppError(`WhatsApp could not send this message: ${sendError ?? "unknown error"}`);
    }
    return message;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not send this template"));
  }
}

export async function sendTemplateMessage(
  tenantId: string,
  userId: string,
  rawInput: unknown,
  db?: SupabaseClient,
): Promise<WhatsAppMessage> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "whatsapp:send", db);
  const parsed = SendTemplateInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check the template and try again.");
  const input = parsed.data;
  return sendTemplateOutbound(
    tenantId,
    {
      phone: input.phone ?? "",
      templateName: input.templateName,
      language: "sw",
      params: input.params,
      sentBy: userId,
      conversationId: input.conversationId,
    },
    db,
  );
}

/* ------------------------------------------------------------------ */
/* Templates                                                            */
/* ------------------------------------------------------------------ */

export async function listTemplates(
  tenantId: string,
  userId: string,
  db?: SupabaseClient,
): Promise<WhatsAppTemplate[]> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "whatsapp:read", db);
  const client = dbOrAdmin(db);
  try {
    const { data, error } = await client
      .from("whatsapp_templates")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true })
      .limit(200);
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map(toTemplate);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load templates"));
  }
}

export async function createTemplate(
  tenantId: string,
  userId: string,
  rawInput: unknown,
  db?: SupabaseClient,
): Promise<WhatsAppTemplate> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "whatsapp:templates", db);
  const parsed = CreateTemplateInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check the template and try again.");
  const client = dbOrAdmin(db);
  try {
    const { data, error } = await client
      .from("whatsapp_templates")
      .insert({
        tenant_id: tenantId,
        name: parsed.data.name,
        language: parsed.data.language,
        category: parsed.data.category,
        body: parsed.data.body,
        variables: parsed.data.variables,
        status: "DRAFT",
      })
      .select()
      .single();
    if (error) throw error;
    const template = toTemplate(data as Record<string, unknown>);
    await writeAudit(
      { tenantId, userId, action: "whatsapp.template_created", entity: "whatsapp_template", entityId: template.id, metadata: { name: template.name } },
      { throwOnError: false },
      client,
    );
    return template;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not create this template"));
  }
}

export async function updateTemplate(
  tenantId: string,
  userId: string,
  templateId: string,
  rawInput: unknown,
  db?: SupabaseClient,
): Promise<WhatsAppTemplate> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "whatsapp:templates", db);
  const idParsed = z.uuid("Invalid template.").safeParse(templateId);
  if (!idParsed.success) throw new AppError("Invalid template.");
  const parsed = UpdateTemplateInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check the template and try again.");
  const client = dbOrAdmin(db);
  try {
    const patch: Record<string, unknown> = {};
    if (parsed.data.body !== undefined) patch.body = parsed.data.body;
    if (parsed.data.variables !== undefined) patch.variables = parsed.data.variables;
    if (parsed.data.status !== undefined) patch.status = parsed.data.status;
    if (Object.keys(patch).length === 0) throw new AppError("Nothing to update.");
    const { data, error } = await client
      .from("whatsapp_templates")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("id", templateId)
      .select()
      .single();
    if (error) throw error;
    const template = toTemplate(data as Record<string, unknown>);
    await writeAudit(
      { tenantId, userId, action: "whatsapp.template_updated", entity: "whatsapp_template", entityId: template.id, metadata: { name: template.name } },
      { throwOnError: false },
      client,
    );
    return template;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not update this template"));
  }
}

/**
 * Honest stub: listing Meta-approved templates requires a
 * business-management token, which we do not hold. Local templates are the
 * source of truth until real sync is wired up.
 */
export async function syncTemplates(
  tenantId: string,
  userId: string,
  db?: SupabaseClient,
): Promise<{ synced: number; message: string }> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "whatsapp:templates", db);
  return {
    synced: 0,
    message: "Automatic sync needs a business-management token. Templates are managed below.",
  };
}
