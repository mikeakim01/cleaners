import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, humanizeDbError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/server/supabase-admin";
import { writeAudit } from "@/services/audit.service";
import { requirePermission } from "@/services/rbac.service";
import { isBookingStatus } from "@/services/bookings.service";

export const QUOTE_STATUSES = ["DRAFT", "SENT", "APPROVED", "REJECTED", "EXPIRED"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/** Pure transition map — importable for unit tests and UI gating. */
export const QUOTE_TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  DRAFT: ["SENT", "EXPIRED"],
  SENT: ["APPROVED", "REJECTED", "EXPIRED"],
  APPROVED: [],
  REJECTED: [],
  EXPIRED: [],
};

export function canTransitionQuote(from: QuoteStatus, to: QuoteStatus): boolean {
  return QUOTE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertQuoteTransitionAllowed(from: QuoteStatus, to: QuoteStatus): void {
  if (!canTransitionQuote(from, to)) {
    throw new AppError(`Cannot move quote from ${from} to ${to}.`);
  }
}

export const QuoteItemInputSchema = z.object({
  description: z.string().trim().min(2, "Item description must be at least 2 characters.").max(255),
  qty: z.number().positive("Quantity must be greater than zero."),
  unitMinor: z.number().int("Unit price must be a whole number of cents.").min(0, "Unit price cannot be negative."),
});

export const CreateQuoteInputSchema = z.object({
  items: z.array(QuoteItemInputSchema).min(1, "Add at least one line item.").max(50),
  discountMinor: z.number().int().min(0, "Discount cannot be negative.").optional().default(0),
  validUntil: z.string().trim().optional(),
  notes: z.string().trim().max(1000).optional().default(""),
});

export type QuoteItemInput = z.infer<typeof QuoteItemInputSchema>;
export type CreateQuoteInput = z.infer<typeof CreateQuoteInputSchema>;

export interface QuoteItem {
  id: string;
  description: string;
  qty: number;
  unit_price_minor: number;
  total_minor: number;
}

export interface Quote {
  id: string;
  tenant_id: string;
  booking_id: string;
  customer_id: string;
  reference: string;
  status: QuoteStatus;
  subtotal_minor: number;
  discount_minor: number;
  vat_minor: number;
  total_minor: number;
  valid_until: string | null;
  notes: string | null;
  items?: QuoteItem[];
}

export interface QuoteTotals {
  subtotalMinor: number;
  discountMinor: number;
  vatMinor: number;
  totalMinor: number;
}

/**
 * Pure integer-cents totals: subtotal = sum(qty*unit),
 * vat = round((subtotal - discount) * vatRate / 100), total = base + vat.
 */
export function computeQuoteTotals(
  items: ReadonlyArray<{ qty: number; unitMinor: number }>,
  discountMinor: number,
  vatRate: number,
): QuoteTotals {
  const subtotalMinor = items.reduce((sum, i) => sum + Math.round(i.qty * i.unitMinor), 0);
  const safeDiscount = Math.min(Math.max(0, Math.floor(discountMinor)), subtotalMinor);
  const taxable = subtotalMinor - safeDiscount;
  const vatMinor = Math.round((taxable * vatRate) / 100);
  return { subtotalMinor, discountMinor: safeDiscount, vatMinor, totalMinor: taxable + vatMinor };
}

/** Pure reference builder. */
export function buildQuoteReference(prefix: string, existingCount: number): string {
  return `${prefix}${1000 + existingCount}`;
}

function dbOrAdmin(db?: SupabaseClient): SupabaseClient {
  return db ?? getSupabaseAdmin();
}

function checkIds(tenantId: string, userId: string): void {
  const parsed = z
    .object({ tenantId: z.uuid("Invalid business."), userId: z.uuid("Invalid user. Please sign in again.") })
    .safeParse({ tenantId, userId });
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request.");
}

function toQuote(row: Record<string, unknown>, items?: QuoteItem[]): Quote {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    booking_id: String(row.booking_id ?? ""),
    customer_id: String(row.customer_id ?? ""),
    reference: String(row.reference ?? ""),
    status: row.status as QuoteStatus,
    subtotal_minor: Number(row.subtotal_minor ?? 0),
    discount_minor: Number(row.discount_minor ?? 0),
    vat_minor: Number(row.vat_minor ?? 0),
    total_minor: Number(row.total_minor ?? 0),
    valid_until: (row.valid_until as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    items,
  };
}

async function getVatRate(client: SupabaseClient, tenantId: string): Promise<number> {
  const { data } = await client
    .from("business_settings")
    .select("vat_rate")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const raw = (data as { vat_rate?: unknown } | null)?.vat_rate;
  const rate = Number(raw ?? 18);
  return Number.isFinite(rate) && rate >= 0 ? rate : 18;
}

async function getQuotePrefix(client: SupabaseClient, tenantId: string): Promise<string> {
  const { data } = await client
    .from("business_settings")
    .select("quote_prefix")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return ((data as { quote_prefix?: unknown } | null)?.quote_prefix as string) || "QUO-";
}

export async function createQuote(
  tenantId: string,
  userId: string,
  bookingId: string,
  rawInput: unknown,
  db?: SupabaseClient,
): Promise<Quote> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "bookings:update", db);
  const idParsed = z.uuid("Invalid booking.").safeParse(bookingId);
  if (!idParsed.success) throw new AppError("Invalid booking.");
  const parsed = CreateQuoteInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check the quote and try again.");
  const input = parsed.data;
  const client = dbOrAdmin(db);

  try {
    const { data: booking, error: bookingError } = await client
      .from("bookings")
      .select("id, customer_id, status")
      .eq("tenant_id", tenantId)
      .eq("id", bookingId)
      .is("deleted_at", null)
      .maybeSingle();
    if (bookingError) throw bookingError;
    if (!booking) throw new AppError("We could not find that booking.");
    const b = booking as { id: string; customer_id: string; status: string };

    const vatRate = await getVatRate(client, tenantId);
    const totals = computeQuoteTotals(input.items, input.discountMinor, vatRate);
    const prefix = await getQuotePrefix(client, tenantId);
    const { count } = await client.from("quotes").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    const reference = buildQuoteReference(prefix, count ?? 0);

    const { data: quoteRow, error: quoteError } = await client
      .from("quotes")
      .insert({
        tenant_id: tenantId,
        booking_id: bookingId,
        customer_id: b.customer_id,
        reference,
        status: "DRAFT",
        subtotal_minor: totals.subtotalMinor,
        discount_minor: totals.discountMinor,
        vat_minor: totals.vatMinor,
        total_minor: totals.totalMinor,
        valid_until: input.validUntil || null,
        notes: input.notes || null,
      })
      .select()
      .single();
    if (quoteError) throw quoteError;
    const quote = quoteRow as Record<string, unknown>;

    const itemRows = input.items.map((i) => ({
      tenant_id: tenantId,
      quote_id: String(quote.id),
      description: i.description,
      qty: i.qty,
      unit_price_minor: i.unitMinor,
      total_minor: Math.round(i.qty * i.unitMinor),
    }));
    const { data: savedItems, error: itemsError } = await client.from("quote_items").insert(itemRows).select();
    if (itemsError) throw itemsError;

    // Booking awaiting a quote moves to QUOTE_REQUIRED when the first draft exists.
    if (b.status === "NEW" || b.status === "PENDING_REVIEW") {
      await client.from("bookings").update({ status: "QUOTE_REQUIRED" }).eq("tenant_id", tenantId).eq("id", bookingId);
    }

    const items = ((savedItems ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      description: String(r.description ?? ""),
      qty: Number(r.qty ?? 0),
      unit_price_minor: Number(r.unit_price_minor ?? 0),
      total_minor: Number(r.total_minor ?? 0),
    }));

    await writeAudit(
      { tenantId, userId, action: "quote.created", entity: "quote", entityId: String(quote.id), metadata: { reference, totalMinor: totals.totalMinor } },
      { throwOnError: false },
      client,
    );
    return toQuote(quote, items);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not create this quote"));
  }
}

async function loadQuote(client: SupabaseClient, tenantId: string, quoteId: string): Promise<Record<string, unknown>> {
  const { data, error } = await client
    .from("quotes")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", quoteId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError("We could not find that quote.");
  return data as Record<string, unknown>;
}

async function setQuoteStatus(
  tenantId: string,
  userId: string,
  quoteId: string,
  to: QuoteStatus,
  bookingTo: string | null,
  auditAction: string,
  db?: SupabaseClient,
): Promise<Quote> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "bookings:update", db);
  const idParsed = z.uuid("Invalid quote.").safeParse(quoteId);
  if (!idParsed.success) throw new AppError("Invalid quote.");
  const client = dbOrAdmin(db);

  try {
    const current = await loadQuote(client, tenantId, quoteId);
    const from = current.status as QuoteStatus;
    assertQuoteTransitionAllowed(from, to);

    const { data, error } = await client
      .from("quotes")
      .update({ status: to })
      .eq("tenant_id", tenantId)
      .eq("id", quoteId)
      .select()
      .single();
    if (error) throw error;

    if (bookingTo && isBookingStatus(bookingTo)) {
      await client
        .from("bookings")
        .update({ status: bookingTo })
        .eq("tenant_id", tenantId)
        .eq("id", String(current.booking_id));
    }

    await writeAudit(
      { tenantId, userId, action: auditAction, entity: "quote", entityId: quoteId, metadata: { from, to } },
      { throwOnError: false },
      client,
    );
    return toQuote(data as Record<string, unknown>);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not update this quote"));
  }
}

/** DRAFT -> SENT, and the booking moves to QUOTE_SENT. */
export async function sendQuote(tenantId: string, userId: string, quoteId: string, db?: SupabaseClient): Promise<Quote> {
  const quote = await setQuoteStatus(tenantId, userId, quoteId, "SENT", "QUOTE_SENT", "quote.sent", db);
  // Best-effort WhatsApp automation — never breaks the send.
  try {
    const { triggerAutomationEvent } = await import("@/services/whatsapp-automations.service");
    await triggerAutomationEvent(tenantId, "quote.sent", {
      customerId: quote.customer_id,
      params: { quoteReference: quote.reference },
    });
  } catch {
    // Automation is fire-and-forget.
  }
  return quote;
}

/** SENT -> APPROVED, and the booking moves to CONFIRMED. */
export async function approveQuote(tenantId: string, userId: string, quoteId: string, db?: SupabaseClient): Promise<Quote> {
  return setQuoteStatus(tenantId, userId, quoteId, "APPROVED", "CONFIRMED", "quote.approved", db);
}

/** SENT -> REJECTED (booking stays for re-quoting). */
export async function rejectQuote(tenantId: string, userId: string, quoteId: string, db?: SupabaseClient): Promise<Quote> {
  return setQuoteStatus(tenantId, userId, quoteId, "REJECTED", null, "quote.rejected", db);
}

export async function getQuote(
  tenantId: string,
  userId: string,
  quoteId: string,
  db?: SupabaseClient,
): Promise<Quote> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "bookings:read", db);
  const idParsed = z.uuid("Invalid quote.").safeParse(quoteId);
  if (!idParsed.success) throw new AppError("Invalid quote.");
  const client = dbOrAdmin(db);

  try {
    const row = await loadQuote(client, tenantId, quoteId);
    const { data: items } = await client
      .from("quote_items")
      .select("id, description, qty, unit_price_minor, total_minor")
      .eq("tenant_id", tenantId)
      .eq("quote_id", quoteId)
      .is("deleted_at", null);
    const mapped = ((items ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      description: String(r.description ?? ""),
      qty: Number(r.qty ?? 0),
      unit_price_minor: Number(r.unit_price_minor ?? 0),
      total_minor: Number(r.total_minor ?? 0),
    }));
    return toQuote(row, mapped);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load this quote"));
  }
}

export const ListQuotesFilterSchema = z.object({
  bookingId: z.uuid("Invalid booking.").optional(),
  status: z.enum(QUOTE_STATUSES).optional(),
  search: z.string().trim().max(120).optional(),
});

export type ListQuotesFilter = z.infer<typeof ListQuotesFilterSchema>;

export async function listQuotesForBooking(
  tenantId: string,
  userId: string,
  bookingId: string,
  db?: SupabaseClient,
): Promise<Quote[]> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "bookings:read", db);
  const idParsed = z.uuid("Invalid booking.").safeParse(bookingId);
  if (!idParsed.success) throw new AppError("Invalid booking.");
  const client = dbOrAdmin(db);

  try {
    const { data, error } = await client
      .from("quotes")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("booking_id", bookingId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map((r) => toQuote(r));
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load quotes"));
  }
}

export async function listQuotes(
  tenantId: string,
  userId: string,
  rawFilter: unknown = {},
  db?: SupabaseClient,
): Promise<Quote[]> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "bookings:read", db);
  const parsed = ListQuotesFilterSchema.safeParse(rawFilter ?? {});
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid filter.");
  const f = parsed.data;
  const client = dbOrAdmin(db);

  try {
    let query = client
      .from("quotes")
      .select("*")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200);
    if (f.bookingId) query = query.eq("booking_id", f.bookingId);
    if (f.status) query = query.eq("status", f.status);
    if (f.search) {
      const s = f.search.replace(/[%_]/g, "");
      query = query.or(`reference.ilike.%${s}%,notes.ilike.%${s}%`);
    }
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) return [];
    const quoteIds = rows.map((r) => String(r.id));
    const { data: items } = await client
      .from("quote_items")
      .select("id, quote_id, description, qty, unit_price_minor, total_minor")
      .eq("tenant_id", tenantId)
      .in("quote_id", quoteIds)
      .is("deleted_at", null);
    const byQuote = new Map<string, QuoteItem[]>();
    for (const r of ((items ?? []) as Array<Record<string, unknown>>)) {
      const qid = String(r.quote_id ?? "");
      const list = byQuote.get(qid) ?? [];
      list.push({
        id: String(r.id),
        description: String(r.description ?? ""),
        qty: Number(r.qty ?? 0),
        unit_price_minor: Number(r.unit_price_minor ?? 0),
        total_minor: Number(r.total_minor ?? 0),
      });
      byQuote.set(qid, list);
    }
    return rows.map((r) => toQuote(r, byQuote.get(String(r.id))));
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load quotes"));
  }
}
