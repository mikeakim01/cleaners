import "server-only";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, humanizeDbError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/server/supabase-admin";
import { writeAudit } from "@/services/audit.service";
import {
  assertPaymentAllowedOnInvoice,
  assertPaymentWithinBalance,
} from "@/services/payments.service";

export const TANZANIA_PHONE_REGEX = /^\+255\d{9}$/;
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const GENERIC_SENT_MESSAGE = "If this number is registered, a code was sent.";

const SlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "We could not find that business.");
const PhoneSchema = z
  .string()
  .trim()
  .regex(TANZANIA_PHONE_REGEX, "Phone must be a Tanzanian number like +255712345678.");
const IdPairSchema = z.object({
  tenantId: z.uuid("Invalid business."),
  customerId: z.uuid("Invalid customer."),
});

export interface PortalCustomer {
  id: string;
  tenant_id: string;
  full_name: string;
  phone_e164: string;
  email: string | null;
  address: string | null;
  ward: string | null;
}

export interface PortalBooking {
  id: string;
  reference: string;
  status: string;
  amount_minor: number;
  currency: string;
  scheduled_at: string | null;
  address: string | null;
  created_at: string;
  service_name: string | null;
  balance_minor: number;
}

export interface PortalInvoice {
  id: string;
  reference: string;
  status: string;
  total_minor: number;
  amount_paid_minor: number;
  balance_minor: number;
  currency: string;
  issue_date: string;
  due_date: string | null;
}

/** Pure SHA-256 hex helper — exported for unit tests. */
export function hashAccessCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

/** Pure timing-safe code comparison — exported for unit tests. */
export function codesMatch(storedHashHex: string, candidateCode: string): boolean {
  const candidate = hashAccessCode(candidateCode.trim());
  const a = Buffer.from(storedHashHex, "hex");
  const b = Buffer.from(candidate, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Pure 6-digit code generator — exported for unit tests. */
export function generateAccessCode(): string {
  return String(randomInt(0, 1000000)).padStart(6, "0");
}

function dbOrAdmin(db?: SupabaseClient): SupabaseClient {
  return db ?? getSupabaseAdmin();
}

function toPortalCustomer(row: Record<string, unknown>): PortalCustomer {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    full_name: String(row.full_name ?? ""),
    phone_e164: String(row.phone_e164 ?? ""),
    email: (row.email as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    ward: (row.ward as string | null) ?? null,
  };
}

async function resolveActiveTenant(client: SupabaseClient, rawSlug: unknown): Promise<{ id: string }> {
  const slugParsed = SlugSchema.safeParse(rawSlug);
  if (!slugParsed.success) throw new AppError("We could not find that business.");
  const { data, error } = await client
    .from("tenants")
    .select("id, suspended")
    .eq("slug", slugParsed.data)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new AppError(humanizeDbError(error, "Could not load this business"));
  if (!data || (data as { suspended?: boolean }).suspended) {
    throw new AppError("This business is not taking online bookings right now.");
  }
  return { id: String((data as { id: string }).id) };
}

async function deliverCodeBestEffort(
  client: SupabaseClient,
  tenantId: string,
  phone: string,
  code: string,
): Promise<"whatsapp" | "none"> {
  try {
    const { data: account } = await client
      .from("whatsapp_accounts")
      .select("phone_number_id, access_token_enc, status")
      .eq("tenant_id", tenantId)
      .eq("status", "CONNECTED")
      .is("deleted_at", null)
      .maybeSingle();
    const row = account as { phone_number_id: string; access_token_enc: string; status: string } | null;
    if (!row?.phone_number_id || !row?.access_token_enc) return "none";
    const { decryptSecret } = await import("@/server/crypto");
    const token = await decryptSecret(row.access_token_enc);
    const res = await fetch(`https://graph.facebook.com/v21.0/${row.phone_number_id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone.replace(/^\+/, ""),
        type: "text",
        text: { body: `Your login code is ${code}. It expires in 10 minutes.` },
      }),
    });
    return res.ok ? "whatsapp" : "none";
  } catch {
    return "none";
  }
}

export async function requestLoginCode(
  rawSlug: unknown,
  rawPhone: unknown,
  db?: SupabaseClient,
): Promise<{ message: string; sentVia: "whatsapp" | "none"; devCode?: string }> {
  const phoneParsed = PhoneSchema.safeParse(rawPhone);
  if (!phoneParsed.success) throw new AppError(phoneParsed.error.issues[0]?.message ?? "Enter a valid phone number.");
  const phone = phoneParsed.data;
  const client = dbOrAdmin(db);

  try {
    const tenant = await resolveActiveTenant(client, rawSlug);
    const { data: customer } = await client
      .from("customers")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("phone_e164", phone)
      .is("deleted_at", null)
      .maybeSingle();

    if (!customer) {
      return { message: GENERIC_SENT_MESSAGE, sentVia: "none" };
    }
    const customerId = String((customer as { id: string }).id);

    await client
      .from("customer_access_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("tenant_id", tenant.id)
      .eq("customer_id", customerId)
      .is("used_at", null);

    const code = generateAccessCode();
    const { error: insertError } = await client.from("customer_access_codes").insert({
      tenant_id: tenant.id,
      customer_id: customerId,
      code_hash: hashAccessCode(code),
      purpose: "portal_login",
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
      attempts: 0,
    });
    if (insertError) throw insertError;

    const sentVia = await deliverCodeBestEffort(client, tenant.id, phone, code);
    return {
      message: GENERIC_SENT_MESSAGE,
      sentVia,
      ...(process.env.NODE_ENV === "development" ? { devCode: code } : {}),
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not send a login code"));
  }
}

export async function verifyLoginCode(
  rawSlug: unknown,
  rawPhone: unknown,
  rawCode: unknown,
  db?: SupabaseClient,
): Promise<{ customer: PortalCustomer }> {
  const phoneParsed = PhoneSchema.safeParse(rawPhone);
  if (!phoneParsed.success) throw new AppError(phoneParsed.error.issues[0]?.message ?? "Enter a valid phone number.");
  const codeParsed = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code we sent.").safeParse(rawCode);
  if (!codeParsed.success) throw new AppError(codeParsed.error.issues[0]?.message ?? "Enter the 6-digit code we sent.");
  const client = dbOrAdmin(db);

  try {
    const tenant = await resolveActiveTenant(client, rawSlug);
    const { data: customerRow, error: customerError } = await client
      .from("customers")
      .select("id, tenant_id, full_name, phone_e164, email, address, ward")
      .eq("tenant_id", tenant.id)
      .eq("phone_e164", phoneParsed.data)
      .is("deleted_at", null)
      .maybeSingle();
    if (customerError) throw customerError;
    if (!customerRow) throw new AppError("That code is invalid or has expired. Request a new one.");

    const { data: codeRow, error: codeError } = await client
      .from("customer_access_codes")
      .select("id, code_hash, expires_at, used_at, attempts")
      .eq("tenant_id", tenant.id)
      .eq("customer_id", String((customerRow as { id: string }).id))
      .eq("purpose", "portal_login")
      .is("used_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (codeError) throw codeError;
    if (!codeRow) throw new AppError("That code is invalid or has expired. Request a new one.");
    const row = codeRow as { id: string; code_hash: string; expires_at: string; used_at: string | null; attempts: number };

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await client.from("customer_access_codes").update({ used_at: new Date().toISOString() }).eq("id", row.id);
      throw new AppError("That code has expired. Request a new one.");
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      throw new AppError("Too many attempts. Request a new code.");
    }
    if (!codesMatch(row.code_hash, codeParsed.data)) {
      await client.from("customer_access_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
      throw new AppError("That code is incorrect. Check the message and try again.");
    }

    await client
      .from("customer_access_codes")
      .update({ used_at: new Date().toISOString(), attempts: row.attempts + 1 })
      .eq("id", row.id);

    return { customer: toPortalCustomer(customerRow as Record<string, unknown>) };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not verify this code"));
  }
}

export async function getPortalCustomer(
  tenantId: string,
  customerId: string,
  db?: SupabaseClient,
): Promise<PortalCustomer> {
  const parsed = IdPairSchema.safeParse({ tenantId, customerId });
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request.");
  const client = dbOrAdmin(db);
  try {
    const { data, error } = await client
      .from("customers")
      .select("id, tenant_id, full_name, phone_e164, email, address, ward")
      .eq("tenant_id", tenantId)
      .eq("id", customerId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new AppError("We could not find your account. Please log in again.");
    return toPortalCustomer(data as Record<string, unknown>);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load your account"));
  }
}

export async function listPortalBookings(
  tenantId: string,
  customerId: string,
  db?: SupabaseClient,
): Promise<PortalBooking[]> {
  const parsed = IdPairSchema.safeParse({ tenantId, customerId });
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request.");
  const client = dbOrAdmin(db);
  try {
    const { data, error } = await client
      .from("bookings")
      .select("id, reference, status, amount_minor, currency, scheduled_at, address, created_at, services(name)")
      .eq("tenant_id", tenantId)
      .eq("customer_id", customerId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    const rows = ((data ?? []) as Array<Record<string, unknown>>);
    const balanceByBooking = new Map<string, number>();
    try {
      const { data: invoices } = await client
        .from("invoices")
        .select("booking_id, total_minor, amount_paid_minor")
        .eq("tenant_id", tenantId)
        .eq("customer_id", customerId)
        .is("deleted_at", null)
        .limit(200);
      for (const inv of ((invoices ?? []) as Array<Record<string, unknown>>)) {
        const bid = String(inv.booking_id ?? "");
        if (!bid) continue;
        const bal = Math.max(0, Number(inv.total_minor ?? 0) - Number(inv.amount_paid_minor ?? 0));
        balanceByBooking.set(bid, (balanceByBooking.get(bid) ?? 0) + bal);
      }
    } catch {
      // Balances stay zero when the invoice lookup fails.
    }
    return rows.map((r) => {
      const service = r.services as { name?: unknown } | null;
      const id = String(r.id);
      return {
        id,
        reference: String(r.reference ?? ""),
        status: String(r.status ?? ""),
        amount_minor: Number(r.amount_minor ?? 0),
        currency: String(r.currency ?? "TZS"),
        scheduled_at: (r.scheduled_at as string | null) ?? null,
        address: (r.address as string | null) ?? null,
        created_at: String(r.created_at ?? ""),
        service_name: typeof service?.name === "string" ? service.name : null,
        balance_minor: balanceByBooking.get(id) ?? 0,
      };
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load your bookings"));
  }
}

export async function listPortalInvoices(
  tenantId: string,
  customerId: string,
  db?: SupabaseClient,
): Promise<PortalInvoice[]> {
  const parsed = IdPairSchema.safeParse({ tenantId, customerId });
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request.");
  const client = dbOrAdmin(db);
  try {
    const { data, error } = await client
      .from("invoices")
      .select("id, reference, status, total_minor, amount_paid_minor, currency, issue_date, due_date")
      .eq("tenant_id", tenantId)
      .eq("customer_id", customerId)
      .is("deleted_at", null)
      .order("issue_date", { ascending: false })
      .limit(100);
    if (error) throw error;
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
      const total = Number(r.total_minor ?? 0);
      const paid = Number(r.amount_paid_minor ?? 0);
      return {
        id: String(r.id),
        reference: String(r.reference ?? ""),
        status: String(r.status ?? ""),
        total_minor: total,
        amount_paid_minor: paid,
        balance_minor: total - paid,
        currency: String(r.currency ?? "TZS"),
        issue_date: String(r.issue_date ?? ""),
        due_date: (r.due_date as string | null) ?? null,
      };
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load your invoices"));
  }
}

export const SubmitPortalPaymentSchema = z.object({
  invoiceReference: z.string().trim().min(1, "Select an invoice for this payment.").max(60),
  amountMinor: z.number().int().positive("Payment amount must be greater than zero."),
  providerRef: z.string().trim().min(1, "Enter the M-Pesa transaction code.").max(64),
});

export async function submitPortalPayment(
  tenantId: string,
  customerId: string,
  rawInput: unknown,
  db?: SupabaseClient,
): Promise<{ paymentId: string; pending: boolean; message: string }> {
  const ids = IdPairSchema.safeParse({ tenantId, customerId });
  if (!ids.success) throw new AppError(ids.error.issues[0]?.message ?? "Invalid request.");
  const parsed = SubmitPortalPaymentSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check the payment and try again.");
  const input = parsed.data;
  const client = dbOrAdmin(db);

  try {
    const { data: invoiceData, error: invoiceError } = await client
      .from("invoices")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("customer_id", customerId)
      .eq("reference", input.invoiceReference)
      .is("deleted_at", null)
      .maybeSingle();
    if (invoiceError) throw invoiceError;
    if (!invoiceData) throw new AppError("We could not find that invoice.");
    const invoice = invoiceData as Record<string, unknown>;

    assertPaymentAllowedOnInvoice(String(invoice.status ?? ""));
    assertPaymentWithinBalance(
      input.amountMinor,
      Number(invoice.total_minor ?? 0),
      Number(invoice.amount_paid_minor ?? 0),
      String(invoice.currency ?? "TZS"),
    );

    const { recordProviderPayment } = await import("@/server/providers/payments");
    const providerResult = await recordProviderPayment(
      "mobile_money",
      {
        tenantId,
        invoiceId: String(invoice.id),
        amountMinor: input.amountMinor,
        providerRef: input.providerRef,
      },
      { userId: customerId },
    );

    const paymentStatus = providerResult.status === "CONFIRMED" ? "CONFIRMED" : "PENDING";
    const { data: paymentRow, error: paymentError } = await client
      .from("payments")
      .insert({
        tenant_id: tenantId,
        invoice_id: String(invoice.id),
        amount_minor: input.amountMinor,
        provider: "mobile_money",
        provider_ref: providerResult.providerRef,
        status: paymentStatus,
        notes: "Submitted via customer portal.",
      })
      .select("id")
      .single();
    if (paymentError) throw paymentError;

    await writeAudit(
      {
        tenantId,
        userId: customerId,
        action: "payment.submitted_portal",
        entity: "payment",
        entityId: String((paymentRow as { id: string }).id),
        metadata: { invoiceReference: input.invoiceReference, amountMinor: input.amountMinor, source: "portal" },
      },
      { throwOnError: false },
      client,
    );

    return {
      paymentId: String((paymentRow as { id: string }).id),
      pending: paymentStatus === "PENDING",
      message:
        paymentStatus === "CONFIRMED"
          ? "Payment recorded. Thank you!"
          : "We received your payment claim. It will confirm when the money arrives.",
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not submit this payment"));
  }
}
