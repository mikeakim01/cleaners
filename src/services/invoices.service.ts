import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, humanizeDbError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/server/supabase-admin";
import { writeAudit } from "@/services/audit.service";
import { requirePermission } from "@/services/rbac.service";

export const INVOICE_STATUSES = ["DRAFT", "SENT", "PARTIAL", "PAID", "OVERDUE", "VOID"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface InvoiceItemInput {
  description: string;
  qty: number;
  unitMinor: number;
}

export interface InvoiceItem {
  id: string;
  description: string;
  qty: number;
  unit_price_minor: number;
  total_minor: number;
}

export interface InvoicePayment {
  id: string;
  amount_minor: number;
  provider: string;
  provider_ref: string | null;
  status: string;
  received_at: string;
}

export interface Invoice {
  id: string;
  tenant_id: string;
  booking_id: string | null;
  customer_id: string;
  reference: string;
  status: InvoiceStatus;
  subtotal_minor: number;
  discount_minor: number;
  vat_minor: number;
  surcharge_minor: number;
  total_minor: number;
  amount_paid_minor: number;
  currency: string;
  issue_date: string;
  due_date: string | null;
  notes: string | null;
  items?: InvoiceItem[];
  payments?: InvoicePayment[];
  /** Joined display names (present when the row was loaded with relations). */
  customer_name?: string;
  booking_reference?: string | null;
  branch_name?: string | null;
}

export interface InvoiceTotals {
  subtotalMinor: number;
  discountMinor: number;
  vatMinor: number;
  surchargeMinor: number;
  totalMinor: number;
}

/**
 * Pure integer-cents totals: subtotal = sum(qty*unit),
 * vat = round((subtotal - discount) * vatRate / 100),
 * total = subtotal - discount + vat + surcharge.
 * Discount is clamped to the subtotal so totals never go negative.
 */
export function computeInvoiceTotals(
  items: ReadonlyArray<{ qty: number; unitMinor: number }>,
  discountMinor: number,
  surchargeMinor: number,
  vatRate: number,
): InvoiceTotals {
  const subtotalMinor = items.reduce((sum, i) => sum + Math.round(i.qty * i.unitMinor), 0);
  const safeDiscount = Math.min(Math.max(0, Math.floor(discountMinor)), subtotalMinor);
  const safeSurcharge = Math.max(0, Math.floor(surchargeMinor));
  const taxable = subtotalMinor - safeDiscount;
  const vatMinor = Math.round((taxable * vatRate) / 100);
  return {
    subtotalMinor,
    discountMinor: safeDiscount,
    vatMinor,
    surchargeMinor: safeSurcharge,
    totalMinor: taxable + vatMinor + safeSurcharge,
  };
}

/** Pure reference builder: PREFIX + (1000 + existingCount). */
export function buildInvoiceReference(prefix: string, existingCount: number): string {
  return `${prefix}${1000 + existingCount}`;
}

/**
 * Pure status recalculation from confirmed payment coverage.
 * DRAFT and VOID are untouched; otherwise paid>=total -> PAID,
 * paid>0 -> PARTIAL, else SENT.
 */
export function recalcInvoiceStatus(
  invoice: { status: InvoiceStatus; total_minor: number; amount_paid_minor: number },
  payments: ReadonlyArray<{ status: string; amount_minor: number }>,
): InvoiceStatus {
  if (invoice.status === "DRAFT" || invoice.status === "VOID") return invoice.status;
  const paid = payments
    .filter((p) => p.status === "CONFIRMED")
    .reduce((sum, p) => sum + p.amount_minor, 0);
  if (paid >= invoice.total_minor) return "PAID";
  if (paid > 0) return "PARTIAL";
  return "SENT";
}

/** Pure overdue check: SENT with a due date strictly before today. */
export function isOverdue(status: InvoiceStatus, dueDate: string | null, now: Date = new Date()): boolean {
  if (status !== "SENT" || !dueDate) return false;
  const today = now.toISOString().slice(0, 10);
  return dueDate < today;
}

/** Pure send guard — throws the human message unless the invoice is a draft. */
export function assertInvoiceCanSend(status: InvoiceStatus): void {
  if (status !== "DRAFT") {
    throw new AppError(`Only draft invoices can be sent. This invoice is ${status}.`);
  }
}

/** Pure void guard — paid work can never be voided. */
export function assertInvoiceCanVoid(status: InvoiceStatus): void {
  if (status === "PAID" || status === "PARTIAL") {
    throw new AppError("Only unpaid invoices can be voided.");
  }
  if (status !== "DRAFT" && status !== "SENT" && status !== "OVERDUE") {
    throw new AppError(`Cannot void an invoice with status ${status}.`);
  }
}

export const InvoiceItemInputSchema = z.object({
  description: z.string().trim().min(2, "Item description must be at least 2 characters.").max(255),
  qty: z.number().positive("Quantity must be greater than zero."),
  unitMinor: z.number().int("Unit price must be a whole number of cents.").min(0, "Unit price cannot be negative."),
});

export const CreateInvoiceInputSchema = z.object({
  bookingReference: z.string().trim().max(60).optional(),
  bookingId: z.uuid("Invalid booking.").optional(),
  customerId: z.uuid("Invalid customer.").optional(),
  items: z.array(InvoiceItemInputSchema).min(1, "Add at least one line item.").max(50),
  discountMinor: z.number().int().min(0, "Discount cannot be negative.").optional().default(0),
  surchargeMinor: z.number().int().min(0, "Surcharge cannot be negative.").optional().default(0),
  dueDate: z.string().trim().optional().default(""),
  notes: z.string().trim().max(1000).optional().default(""),
});

export type CreateInvoiceInput = z.infer<typeof CreateInvoiceInputSchema>;

export const ListInvoicesFilterSchema = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  search: z.string().trim().max(120).optional(),
});

export type ListInvoicesFilter = z.infer<typeof ListInvoicesFilterSchema>;

function dbOrAdmin(db?: SupabaseClient): SupabaseClient {
  return db ?? getSupabaseAdmin();
}

function checkIds(tenantId: string, userId: string): void {
  const parsed = z
    .object({ tenantId: z.uuid("Invalid business."), userId: z.uuid("Invalid user. Please sign in again.") })
    .safeParse({ tenantId, userId });
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request.");
}

function toInvoiceItem(r: Record<string, unknown>): InvoiceItem {
  return {
    id: String(r.id),
    description: String(r.description ?? ""),
    qty: Number(r.qty ?? 0),
    unit_price_minor: Number(r.unit_price_minor ?? 0),
    total_minor: Number(r.total_minor ?? 0),
  };
}

function toInvoicePayment(r: Record<string, unknown>): InvoicePayment {
  return {
    id: String(r.id),
    amount_minor: Number(r.amount_minor ?? 0),
    provider: String(r.provider ?? ""),
    provider_ref: (r.provider_ref as string | null) ?? null,
    status: String(r.status ?? ""),
    received_at: String(r.received_at ?? ""),
  };
}

function toInvoice(row: Record<string, unknown>, items?: InvoiceItem[], payments?: InvoicePayment[]): Invoice {
  const customer = row.customers as { full_name?: unknown } | null;
  const booking = row.bookings as
    | { reference?: unknown; branches?: { name?: unknown } | null }
    | null;
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    booking_id: (row.booking_id as string | null) ?? null,
    customer_id: String(row.customer_id ?? ""),
    reference: String(row.reference ?? ""),
    status: row.status as InvoiceStatus,
    subtotal_minor: Number(row.subtotal_minor ?? 0),
    discount_minor: Number(row.discount_minor ?? 0),
    vat_minor: Number(row.vat_minor ?? 0),
    surcharge_minor: Number(row.surcharge_minor ?? 0),
    total_minor: Number(row.total_minor ?? 0),
    amount_paid_minor: Number(row.amount_paid_minor ?? 0),
    currency: String(row.currency ?? "TZS"),
    issue_date: String(row.issue_date ?? ""),
    due_date: (row.due_date as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    items,
    payments,
    customer_name: typeof customer?.full_name === "string" ? customer.full_name : undefined,
    booking_reference:
      typeof booking?.reference === "string" ? booking.reference : null,
    branch_name:
      typeof booking?.branches?.name === "string" ? booking.branches.name : null,
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

async function getInvoicePrefix(client: SupabaseClient, tenantId: string): Promise<string> {
  const { data } = await client
    .from("business_settings")
    .select("invoice_prefix")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return ((data as { invoice_prefix?: unknown } | null)?.invoice_prefix as string) || "INV-";
}

/** Resolve a booking by uuid id or by reference (mirrors bookings.service getBooking). */
async function resolveBooking(
  client: SupabaseClient,
  tenantId: string,
  bookingId?: string,
  bookingReference?: string,
): Promise<{ id: string; customer_id: string; status: string } | null> {
  const identifier = (bookingId ?? bookingReference ?? "").trim();
  if (!identifier) return null;
  const isUuid = z.uuid("Invalid booking.").safeParse(identifier).success;
  let query = client
    .from("bookings")
    .select("id, customer_id, status")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);
  query = isUuid ? query.eq("id", identifier) : query.eq("reference", identifier);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError("We could not find that booking.");
  return data as { id: string; customer_id: string; status: string };
}

async function loadInvoiceRow(client: SupabaseClient, tenantId: string, invoiceId: string): Promise<Record<string, unknown>> {
  const { data, error } = await client
    .from("invoices")
    .select("*, customers(full_name), bookings(reference, branches(name))")
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError("We could not find that invoice.");
  return data as Record<string, unknown>;
}

async function loadItems(client: SupabaseClient, tenantId: string, invoiceId: string): Promise<InvoiceItem[]> {
  const { data } = await client
    .from("invoice_items")
    .select("id, description, qty, unit_price_minor, total_minor")
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId)
    .is("deleted_at", null);
  return ((data ?? []) as Record<string, unknown>[]).map(toInvoiceItem);
}

async function loadPayments(client: SupabaseClient, tenantId: string, invoiceId: string): Promise<InvoicePayment[]> {
  const { data } = await client
    .from("payments")
    .select("id, amount_minor, provider, provider_ref, status, received_at")
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId)
    .is("deleted_at", null)
    .order("received_at", { ascending: true });
  return ((data ?? []) as Record<string, unknown>[]).map(toInvoicePayment);
}

export async function createInvoice(
  tenantId: string,
  userId: string,
  rawInput: unknown,
  db?: SupabaseClient,
): Promise<Invoice> {
  checkIds(tenantId, userId);
  // No invoices:* permission exists in src/rbac/permissions.ts — invoice writes
  // reuse bookings:update (OWNER/ADMIN hold all; managers/supervisors included).
  await requirePermission(tenantId, userId, "bookings:update", db);
  const parsed = CreateInvoiceInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check the invoice and try again.");
  const input = parsed.data;
  const client = dbOrAdmin(db);

  try {
    const booking = await resolveBooking(client, tenantId, input.bookingId, input.bookingReference);

    let customerId = input.customerId ?? booking?.customer_id ?? "";
    if (!customerId) throw new AppError("Select a customer for this invoice.");
    if (input.customerId) {
      const { data: customer, error: customerError } = await client
        .from("customers")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("id", input.customerId)
        .is("deleted_at", null)
        .maybeSingle();
      if (customerError) throw customerError;
      if (!customer) throw new AppError("The selected customer could not be found. Please refresh and try again.");
    } else {
      customerId = booking!.customer_id;
    }

    const subtotalPreview = input.items.reduce((sum, i) => sum + Math.round(i.qty * i.unitMinor), 0);
    if (input.discountMinor > subtotalPreview) {
      throw new AppError("Discount cannot exceed the subtotal.");
    }

    const vatRate = await getVatRate(client, tenantId);
    const totals = computeInvoiceTotals(input.items, input.discountMinor, input.surchargeMinor, vatRate);
    const prefix = await getInvoicePrefix(client, tenantId);
    const { count } = await client.from("invoices").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    const reference = buildInvoiceReference(prefix, count ?? 0);

    const { data: invoiceRow, error: invoiceError } = await client
      .from("invoices")
      .insert({
        tenant_id: tenantId,
        booking_id: booking?.id ?? null,
        customer_id: customerId,
        reference,
        status: "DRAFT",
        subtotal_minor: totals.subtotalMinor,
        discount_minor: totals.discountMinor,
        vat_minor: totals.vatMinor,
        surcharge_minor: totals.surchargeMinor,
        total_minor: totals.totalMinor,
        amount_paid_minor: 0,
        currency: "TZS",
        due_date: input.dueDate || null,
        notes: input.notes || null,
      })
      .select()
      .single();
    if (invoiceError) throw invoiceError;
    const row = invoiceRow as Record<string, unknown>;

    const itemRows = input.items.map((i) => ({
      tenant_id: tenantId,
      invoice_id: String(row.id),
      description: i.description,
      qty: i.qty,
      unit_price_minor: i.unitMinor,
      total_minor: Math.round(i.qty * i.unitMinor),
    }));
    const { data: savedItems, error: itemsError } = await client.from("invoice_items").insert(itemRows).select();
    if (itemsError) throw itemsError;

    const items = ((savedItems ?? []) as Record<string, unknown>[]).map(toInvoiceItem);

    await writeAudit(
      { tenantId, userId, action: "invoice.created", entity: "invoice", entityId: String(row.id), metadata: { reference, totalMinor: totals.totalMinor } },
      { throwOnError: false },
      client,
    );
    return toInvoice(row, items, []);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not create this invoice"));
  }
}

/** DRAFT -> SENT; a linked COMPLETED booking moves to PAYMENT_PENDING. */
export async function sendInvoice(
  tenantId: string,
  userId: string,
  invoiceId: string,
  db?: SupabaseClient,
): Promise<Invoice> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "bookings:update", db);
  const idParsed = z.uuid("Invalid invoice.").safeParse(invoiceId);
  if (!idParsed.success) throw new AppError("Invalid invoice.");
  const client = dbOrAdmin(db);

  try {
    const current = await loadInvoiceRow(client, tenantId, invoiceId);
    assertInvoiceCanSend(current.status as InvoiceStatus);

    const { data, error } = await client
      .from("invoices")
      .update({ status: "SENT" })
      .eq("tenant_id", tenantId)
      .eq("id", invoiceId)
      .select()
      .single();
    if (error) throw error;

    if (current.booking_id) {
      const { data: booking } = await client
        .from("bookings")
        .select("id, status")
        .eq("tenant_id", tenantId)
        .eq("id", String(current.booking_id))
        .is("deleted_at", null)
        .maybeSingle();
      const status = (booking as { status?: unknown } | null)?.status;
      if (status === "COMPLETED") {
        await client
          .from("bookings")
          .update({ status: "PAYMENT_PENDING" })
          .eq("tenant_id", tenantId)
          .eq("id", String(current.booking_id));
      }
    }

    await writeAudit(
      { tenantId, userId, action: "invoice.sent", entity: "invoice", entityId: invoiceId, metadata: { from: "DRAFT", to: "SENT" } },
      { throwOnError: false },
      client,
    );

    // Best-effort WhatsApp automation — never breaks the send.
    try {
      const { triggerAutomationEvent } = await import("@/services/whatsapp-automations.service");
      await triggerAutomationEvent(tenantId, "invoice.sent", {
        customerId: typeof current.customer_id === "string" ? String(current.customer_id) : undefined,
        params: typeof current.reference === "string" ? { invoiceReference: String(current.reference) } : {},
      });
    } catch {
      // Automation is fire-and-forget.
    }
    return toInvoice(data as Record<string, unknown>);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not send this invoice"));
  }
}

/** DRAFT|SENT|OVERDUE -> VOID. Paid or partially paid invoices cannot be voided. */
export async function voidInvoice(
  tenantId: string,
  userId: string,
  invoiceId: string,
  db?: SupabaseClient,
): Promise<Invoice> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "bookings:update", db);
  const idParsed = z.uuid("Invalid invoice.").safeParse(invoiceId);
  if (!idParsed.success) throw new AppError("Invalid invoice.");
  const client = dbOrAdmin(db);

  try {
    const current = await loadInvoiceRow(client, tenantId, invoiceId);
    const status = current.status as InvoiceStatus;
    assertInvoiceCanVoid(status);

    const { data, error } = await client
      .from("invoices")
      .update({ status: "VOID" })
      .eq("tenant_id", tenantId)
      .eq("id", invoiceId)
      .select()
      .single();
    if (error) throw error;

    await writeAudit(
      { tenantId, userId, action: "invoice.voided", entity: "invoice", entityId: invoiceId, metadata: { from: status, to: "VOID" } },
      { throwOnError: false },
      client,
    );
    return toInvoice(data as Record<string, unknown>);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not void this invoice"));
  }
}

/** Flip a single SENT invoice to OVERDUE when its due date has passed. */
export async function markOverdue(
  tenantId: string,
  userId: string,
  invoiceId: string,
  db?: SupabaseClient,
): Promise<Invoice> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "bookings:update", db);
  const idParsed = z.uuid("Invalid invoice.").safeParse(invoiceId);
  if (!idParsed.success) throw new AppError("Invalid invoice.");
  const client = dbOrAdmin(db);

  try {
    const current = await loadInvoiceRow(client, tenantId, invoiceId);
    if (!isOverdue(current.status as InvoiceStatus, (current.due_date as string | null) ?? null)) {
      return toInvoice(current);
    }
    const { data, error } = await client
      .from("invoices")
      .update({ status: "OVERDUE" })
      .eq("tenant_id", tenantId)
      .eq("id", invoiceId)
      .select()
      .single();
    if (error) throw error;

    await writeAudit(
      { tenantId, userId, action: "invoice.overdue", entity: "invoice", entityId: invoiceId, metadata: { from: "SENT", to: "OVERDUE" } },
      { throwOnError: false },
      client,
    );
    return toInvoice(data as Record<string, unknown>);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not update this invoice"));
  }
}

export async function getInvoice(
  tenantId: string,
  userId: string,
  invoiceId: string,
  db?: SupabaseClient,
): Promise<Invoice> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "bookings:read", db);
  const idParsed = z.uuid("Invalid invoice.").safeParse(invoiceId);
  if (!idParsed.success) throw new AppError("Invalid invoice.");
  const client = dbOrAdmin(db);

  try {
    const row = await loadInvoiceRow(client, tenantId, invoiceId);
    const [items, payments] = await Promise.all([
      loadItems(client, tenantId, invoiceId),
      loadPayments(client, tenantId, invoiceId),
    ]);
    return toInvoice(row, items, payments);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load this invoice"));
  }
}

/** Explicit reference lookup — same shape as getInvoice. */
export async function getInvoiceByReference(
  tenantId: string,
  userId: string,
  reference: string,
  db?: SupabaseClient,
): Promise<Invoice> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "bookings:read", db);
  const ref = (reference ?? "").trim();
  if (!ref) throw new AppError("Invalid invoice.");
  const client = dbOrAdmin(db);

  try {
    const { data, error } = await client
      .from("invoices")
      .select("*, customers(full_name), bookings(reference, branches(name))")
      .eq("tenant_id", tenantId)
      .eq("reference", ref)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new AppError("We could not find that invoice.");
    const row = data as Record<string, unknown>;
    const invoiceId = String(row.id);
    const [items, payments] = await Promise.all([
      loadItems(client, tenantId, invoiceId),
      loadPayments(client, tenantId, invoiceId),
    ]);
    return toInvoice(row, items, payments);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load this invoice"));
  }
}

export async function listInvoices(
  tenantId: string,
  userId: string,
  rawFilter: unknown = {},
  db?: SupabaseClient,
): Promise<Invoice[]> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "bookings:read", db);
  const parsed = ListInvoicesFilterSchema.safeParse(rawFilter ?? {});
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid filter.");
  const f = parsed.data;
  const client = dbOrAdmin(db);

  try {
    let query = client
      .from("invoices")
      .select("*, customers(full_name), bookings(reference, branches(name))")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200);
    if (f.status) query = query.eq("status", f.status);
    if (f.search) {
      const s = f.search.replace(/[%_]/g, "");
      query = query.or(`reference.ilike.%${s}%,notes.ilike.%${s}%`);
    }
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map((r) => toInvoice(r));
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load invoices"));
  }
}

/** Shared status refresh after a confirmed payment lands on an invoice row. */
export async function refreshInvoiceStatus(
  client: SupabaseClient,
  tenantId: string,
  invoice: { id: string; status: InvoiceStatus; total_minor: number; amount_paid_minor: number },
): Promise<InvoiceStatus> {
  if (invoice.status === "DRAFT" || invoice.status === "VOID") return invoice.status;
  const { data } = await client
    .from("payments")
    .select("status, amount_minor")
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoice.id)
    .is("deleted_at", null);
  const next = recalcInvoiceStatus(invoice, ((data ?? []) as Array<{ status: string; amount_minor: number }>));
  if (next !== invoice.status) {
    await client.from("invoices").update({ status: next }).eq("tenant_id", tenantId).eq("id", invoice.id);
  }
  return next;
}
