import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/server/supabase-admin";
import {
  normalizeWaPhone,
  resolveConversation,
  type ParsedInboundMessage,
  type ParsedStatusUpdate,
  type ParsedWebhook,
} from "@/services/whatsapp.service";

export interface RoutedAccount {
  id: string;
  tenant_id: string;
  phone_number_id: string;
  status: string;
}

export interface IngestResult {
  routed: boolean;
  received?: number;
  deduped?: number;
  statusUpdates?: number;
  error?: string;
}

function dbOrAdmin(db?: SupabaseClient): SupabaseClient {
  return db ?? getSupabaseAdmin();
}

/**
 * Best-effort audit for webhook-driven events. Webhooks carry no user, and
 * audit_logs.user_id is nullable, so we insert directly instead of going
 * through writeAudit (whose schema requires a user id). Never throws.
 */
async function systemAudit(
  client: SupabaseClient,
  entry: { tenantId: string; action: string; entity: string; entityId?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  try {
    await client.from("audit_logs").insert({
      tenant_id: entry.tenantId,
      user_id: null,
      action: entry.action,
      entity: entry.entity,
      entity_id: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
    });
  } catch {
    // Audit must never break ingestion.
  }
}

/** Route an inbound change to its tenant via the phone number id. Null when unknown. */
export async function routeAccountByPhoneNumberId(
  phoneNumberId: string,
  db?: SupabaseClient,
): Promise<RoutedAccount | null> {
  if (!phoneNumberId) return null;
  const client = dbOrAdmin(db);
  const { data, error } = await client
    .from("whatsapp_accounts")
    .select("id, tenant_id, phone_number_id, status")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    phone_number_id: String(row.phone_number_id ?? ""),
    status: String(row.status ?? ""),
  };
}

const OUTBOUND_STATUS_MAP: Record<string, string> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

export async function processStatus(
  account: RoutedAccount,
  st: ParsedStatusUpdate,
  db?: SupabaseClient,
): Promise<{ updated: boolean }> {
  const client = dbOrAdmin(db);
  const next = OUTBOUND_STATUS_MAP[st.status];
  if (!next) return { updated: false };
  const { data: existing, error: readError } = await client
    .from("whatsapp_messages")
    .select("id")
    .eq("tenant_id", account.tenant_id)
    .eq("waba_message_id", st.wabaId)
    .eq("direction", "outbound")
    .maybeSingle();
  if (readError || !existing) return { updated: false };
  const patch: Record<string, unknown> = { status: next };
  if (next === "failed") patch.error = "Delivery failed.";
  const { error } = await client
    .from("whatsapp_messages")
    .update(patch)
    .eq("tenant_id", account.tenant_id)
    .eq("id", String((existing as Record<string, unknown>).id));
  if (error) throw error;
  return { updated: true };
}

export async function processInbound(
  account: RoutedAccount,
  msg: ParsedInboundMessage,
  db?: SupabaseClient,
): Promise<{ deduped: boolean; messageId?: string }> {
  const client = dbOrAdmin(db);

  // Idempotency pre-check — Meta may redeliver the same waba id.
  const { data: dup, error: dupError } = await client
    .from("whatsapp_messages")
    .select("id")
    .eq("tenant_id", account.tenant_id)
    .eq("waba_message_id", msg.wabaId)
    .maybeSingle();
  if (dupError) throw dupError;
  if (dup) return { deduped: true };

  const phone = normalizeWaPhone(msg.from);

  // Resolve the customer by phone, else create a minimal record.
  let customerId: string | null = null;
  const { data: customer, error: customerError } = await client
    .from("customers")
    .select("id")
    .eq("tenant_id", account.tenant_id)
    .eq("phone_e164", phone)
    .is("deleted_at", null)
    .maybeSingle();
  if (customerError) throw customerError;
  if (customer) {
    customerId = String((customer as Record<string, unknown>).id);
  } else {
    const { data: created, error: createError } = await client
      .from("customers")
      .insert({ tenant_id: account.tenant_id, full_name: `WhatsApp ${phone}`, phone_e164: phone })
      .select("id")
      .single();
    if (createError) throw createError;
    customerId = String((created as Record<string, unknown>).id);
  }

  const conversation = await resolveConversation(account.tenant_id, phone, customerId, client);

  const { data: inserted, error: insertError } = await client
    .from("whatsapp_messages")
    .insert({
      tenant_id: account.tenant_id,
      conversation_id: conversation.id,
      waba_message_id: msg.wabaId,
      kind: msg.kind,
      direction: "inbound",
      body: msg.body || null,
      template_name: null,
      template_params: null,
      status: "delivered",
      error: null,
      sent_by: null,
    })
    .select("id")
    .single();
  if (insertError) throw insertError;
  const messageId = String((inserted as Record<string, unknown>).id);

  await client
    .from("whatsapp_conversations")
    .update({
      last_message_at: new Date().toISOString(),
      unread_count: conversation.unread_count + 1,
    })
    .eq("tenant_id", account.tenant_id)
    .eq("id", conversation.id);

  await systemAudit(client, {
    tenantId: account.tenant_id,
    action: "whatsapp.message_received",
    entity: "whatsapp_message",
    entityId: messageId,
    metadata: { conversationId: conversation.id, kind: msg.kind },
  });

  return { deduped: false, messageId };
}

/**
 * Ingest one parsed webhook payload. Never throws: every message is wrapped
 * in its own try/catch so one bad message never aborts the batch, and the
 * route always answers 200 to Meta after verification.
 */
export async function ingestParsedPayload(
  parsed: ParsedWebhook,
  db?: SupabaseClient,
): Promise<IngestResult> {
  const client = dbOrAdmin(db);
  try {
    const account = await routeAccountByPhoneNumberId(parsed.phoneNumberId, client);
    if (!account) return { routed: false };
    let received = 0;
    let deduped = 0;
    for (const msg of parsed.messages) {
      try {
        const r = await processInbound(account, msg, client);
        if (r.deduped) deduped += 1;
        else received += 1;
      } catch {
        // One bad message never aborts the batch.
      }
    }
    let statusUpdates = 0;
    for (const st of parsed.statuses) {
      try {
        const r = await processStatus(account, st, client);
        if (r.updated) statusUpdates += 1;
      } catch {
        // Same guarantee for status updates.
      }
    }
    return { routed: true, received, deduped, statusUpdates };
  } catch (err) {
    return { routed: false, error: err instanceof Error ? err.message : "Ingest failed." };
  }
}
