import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, humanizeDbError } from "@/lib/errors";
import { formatMoney } from "@/lib/format";
import { getSupabaseAdmin } from "@/server/supabase-admin";
import { recordProviderPayment, PAYMENT_PROVIDER_IDS } from "@/server/providers/payments";
import { writeAudit } from "@/services/audit.service";
import { requirePermission } from "@/services/rbac.service";
import { refreshInvoiceStatus } from "@/services/invoices.service";

export const PAYMENT_STATUSES = ["PENDING", "CONFIRMED", "FAILED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface Payment {
  id: string;
  tenant_id: string;
  invoice_id: string;
  amount_minor: number;
  provider: string;
  provider_ref: string | null;
  status: PaymentStatus;
  received_at: string;
  notes: string | null;
}

export interface RecordedPayment {
  payment: Payment;
  invoiceStatus: string;
  pending: boolean;
  message: string;
}

export const RecordPaymentInputSchema = z.object({
  invoiceReference: z.string().trim().max(60).optional(),
  invoiceId: z.uuid("Invalid invoice.").optional(),
  amountMinor: z.number().int("Payment amount must be a whole number of cents.").positive("Payment amount must be greater than zero."),
  provider: z.enum(PAYMENT_PROVIDER_IDS, { message: "Unknown payment method. Please choose a valid payment method." }),
  providerRef: z.string().trim().max(64).optional(),
  notes: z.string().trim().max(500).optional().default(""),
});

export type RecordPaymentInput = z.infer<typeof RecordPaymentInputSchema>;

export const ListTenantPaymentsFilterSchema = z.object({
  search: z.string().trim().max(120).optional(),
});

export type ListTenantPaymentsFilter = z.infer<typeof ListTenantPaymentsFilterSchema>;

function dbOrAdmin(db?: SupabaseClient): SupabaseClient {
  return db ?? getSupabaseAdmin();
}

function checkIds(tenantId: string, userId: string): void {
  const parsed = z
    .object({ tenantId: z.uuid("Invalid business."), userId: z.uuid("Invalid user. Please sign in again.") })
    .safeParse({ tenantId, userId });
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request.");
}

function toPayment(row: Record<string, unknown>): Payment {  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    invoice_id: String(row.invoice_id),
    amount_minor: Number(row.amount_minor ?? 0),
    provider: String(row.provider ?? ""),
    provider_ref: (row.provider_ref as string | null) ?? null,
    status: row.status as PaymentStatus,
    received_at: String(row.received_at ?? ""),
    notes: (row.notes as string | null) ?? null,
  };
}

/** Pure invoice-state guard for taking a payment — voided invoices never accept money. */
export function assertPaymentAllowedOnInvoice(status: string): void {
  if (status === "VOID") throw new AppError("Cannot take payment on a voided invoice.");
  if (status === "DRAFT") throw new AppError("Send this invoice before recording a payment.");
}

/** Pure balance guard — the human message names both amounts via formatMoney. */
export function assertPaymentWithinBalance(
  amountMinor: number,
  totalMinor: number,
  amountPaidMinor: number,
  currency = "TZS",
): number {
  const balance = totalMinor - amountPaidMinor;
  if (amountMinor > balance) {
    throw new AppError(
      `Payment of ${formatMoney(amountMinor, currency)} exceeds the ${formatMoney(balance, currency)} balance.`,
    );
  }
  return balance;
}

export async function recordPayment(
  tenantId: string,
  userId: string,
  rawInput: unknown,
  db?: SupabaseClient,
): Promise<RecordedPayment> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "payments:record", db);
  const parsed = RecordPaymentInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check the payment and try again.");
  const input = parsed.data;
  const identifier = (input.invoiceId ?? input.invoiceReference ?? "").trim();
  if (!identifier) throw new AppError("Select an invoice for this payment.");
  const client = dbOrAdmin(db);

  try {
    const isUuid = z.uuid("Invalid invoice.").safeParse(identifier).success;
    let invoiceQuery = client
      .from("invoices")
      .select("*")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null);
    invoiceQuery = isUuid ? invoiceQuery.eq("id", identifier) : invoiceQuery.eq("reference", identifier);
    const { data: invoiceData, error: invoiceLookupError } = await invoiceQuery.maybeSingle();
    if (invoiceLookupError) throw invoiceLookupError;
    const invoiceRow = (invoiceData as Record<string, unknown> | null) ?? null;
    if (!invoiceRow) throw new AppError("We could not find that invoice.");

    const status = String(invoiceRow.status ?? "");
    assertPaymentAllowedOnInvoice(status);

    const total = Number(invoiceRow.total_minor ?? 0);
    const paid = Number(invoiceRow.amount_paid_minor ?? 0);
    const currency = String(invoiceRow.currency ?? "TZS");
    assertPaymentWithinBalance(input.amountMinor, total, paid, currency);

    const invoiceId = String(invoiceRow.id);
    const providerResult = await recordProviderPayment(
      input.provider,
      {
        tenantId,
        invoiceId,
        amountMinor: input.amountMinor,
        providerRef: input.providerRef,
        notes: input.notes || undefined,
      },
      { userId },
    );

    const paymentStatus: PaymentStatus = providerResult.status === "CONFIRMED" ? "CONFIRMED" : "PENDING";
    const { data: paymentRow, error: paymentError } = await client
      .from("payments")
      .insert({
        tenant_id: tenantId,
        invoice_id: invoiceId,
        amount_minor: input.amountMinor,
        provider: input.provider,
        provider_ref: providerResult.providerRef,
        status: paymentStatus,
        notes: input.notes || null,
      })
      .select()
      .single();
    if (paymentError) throw paymentError;

    let invoiceStatus = status;
    let message = "Payment recorded as pending. It will confirm when the money arrives.";
    if (paymentStatus === "CONFIRMED") {
      const newPaid = paid + input.amountMinor;
      await client
        .from("invoices")
        .update({ amount_paid_minor: newPaid })
        .eq("tenant_id", tenantId)
        .eq("id", invoiceId);
      invoiceStatus = await refreshInvoiceStatus(
        client,
        tenantId,
        { id: invoiceId, status: status as never, total_minor: total, amount_paid_minor: newPaid },
      );
      message = invoiceStatus === "PAID" ? "Payment recorded. This invoice is now fully paid." : "Payment recorded. A balance remains on this invoice.";

      if (invoiceStatus === "PAID" && invoiceRow.booking_id) {
        const { data: booking } = await client
          .from("bookings")
          .select("id, status")
          .eq("tenant_id", tenantId)
          .eq("id", String(invoiceRow.booking_id))
          .is("deleted_at", null)
          .maybeSingle();
        if ((booking as { status?: unknown } | null)?.status === "PAYMENT_PENDING") {
          await client
            .from("bookings")
            .update({ status: "PAID" })
            .eq("tenant_id", tenantId)
            .eq("id", String(invoiceRow.booking_id));
        }
      }
    }

    await writeAudit(
      {
        tenantId,
        userId,
        action: "payment.recorded",
        entity: "payment",
        entityId: String((paymentRow as Record<string, unknown>).id),
        metadata: { invoiceId, amountMinor: input.amountMinor, provider: input.provider, status: paymentStatus },
      },
      { throwOnError: false },
      client,
    );

    // Best-effort WhatsApp automation — never breaks the receipt.
    if (paymentStatus === "CONFIRMED") {
      try {
        const { triggerAutomationEvent } = await import("@/services/whatsapp-automations.service");
        await triggerAutomationEvent(tenantId, "payment.received", {
          customerId: typeof invoiceRow.customer_id === "string" ? String(invoiceRow.customer_id) : undefined,
          params: {
            invoiceReference: String(invoiceRow.reference ?? identifier),
            amountMinor: String(input.amountMinor),
          },
        });
      } catch {
        // Automation is fire-and-forget.
      }
    }

    return { payment: toPayment(paymentRow as Record<string, unknown>), invoiceStatus, pending: paymentStatus === "PENDING", message };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not record this payment"));
  }
}

export async function listPayments(
  tenantId: string,
  userId: string,
  invoiceId: string,
  db?: SupabaseClient,
): Promise<Payment[]> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "payments:record", db);
  const idParsed = z.uuid("Invalid invoice.").safeParse(invoiceId);
  if (!idParsed.success) throw new AppError("Invalid invoice.");
  const client = dbOrAdmin(db);

  try {
    const { data, error } = await client
      .from("payments")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("invoice_id", invoiceId)
      .is("deleted_at", null)
      .order("received_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map(toPayment);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load payments"));
  }
}

export async function listTenantPayments(
  tenantId: string,
  userId: string,
  rawFilter: unknown = {},
  db?: SupabaseClient,
): Promise<Payment[]> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "payments:record", db);
  const parsed = ListTenantPaymentsFilterSchema.safeParse(rawFilter ?? {});
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid filter.");
  const client = dbOrAdmin(db);

  try {
    let query = client
      .from("payments")
      .select("*")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("received_at", { ascending: false })
      .limit(200);
    if (parsed.data.search) {
      const s = parsed.data.search.replace(/[%_]/g, "");
      query = query.or(`provider_ref.ilike.%${s}%,notes.ilike.%${s}%`);
    }
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map(toPayment);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load payments"));
  }
}
