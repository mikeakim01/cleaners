import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, humanizeDbError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/server/supabase-admin";
import { writeAudit } from "@/services/audit.service";
import { requirePermission } from "@/services/rbac.service";
import { assertWithinLimits } from "@/services/subscriptions.service";

export const BOOKING_STATUSES = [
  "NEW",
  "PENDING_REVIEW",
  "QUOTE_REQUIRED",
  "QUOTE_SENT",
  "AWAITING_CUSTOMER",
  "CONFIRMED",
  "SCHEDULED",
  "ASSIGNED",
  "EN_ROUTE",
  "ARRIVED",
  "IN_PROGRESS",
  "COMPLETED",
  "PAYMENT_PENDING",
  "PAID",
  "CANCELLED",
  "REJECTED",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Pure transition map — importable for unit tests and UI gating. */
export const ALLOWED_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  NEW: ["PENDING_REVIEW", "CANCELLED", "REJECTED"],
  PENDING_REVIEW: ["QUOTE_REQUIRED", "CONFIRMED", "CANCELLED", "REJECTED"],
  QUOTE_REQUIRED: ["QUOTE_SENT", "CANCELLED"],
  QUOTE_SENT: ["AWAITING_CUSTOMER", "CANCELLED"],
  AWAITING_CUSTOMER: ["CONFIRMED", "QUOTE_REQUIRED", "CANCELLED", "REJECTED"],
  CONFIRMED: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["EN_ROUTE", "CANCELLED"],
  EN_ROUTE: ["ARRIVED"],
  ARRIVED: ["IN_PROGRESS"],
  IN_PROGRESS: ["COMPLETED"],
  COMPLETED: ["PAYMENT_PENDING"],
  PAYMENT_PENDING: ["PAID"],
  PAID: [],
  CANCELLED: [],
  REJECTED: [],
};

export function isBookingStatus(value: unknown): value is BookingStatus {
  return typeof value === "string" && (BOOKING_STATUSES as readonly string[]).includes(value);
}

/** Pure check used by transitionBooking and unit tests. */
export function canTransitionBooking(from: BookingStatus, to: BookingStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Pure assertion — throws the human message on illegal moves. */
export function assertTransitionAllowed(from: BookingStatus, to: BookingStatus): void {
  if (!canTransitionBooking(from, to)) {
    throw new AppError(`Cannot move booking from ${from} to ${to}.`);
  }
}

export const CreateBookingInputSchema = z.object({
  customerId: z.uuid("Invalid customer."),
  serviceId: z.uuid("Invalid service.").optional(),
  branchId: z.uuid("Invalid branch.").optional(),
  amountMinor: z.number().int().min(0, "Amount cannot be negative.").optional().default(0),
  currency: z.string().trim().length(3, "Currency must be a 3-letter code.").optional().default("TZS"),
  scheduledAt: z.string().trim().min(1, "Scheduled date is required.").optional(),
  address: z.string().trim().max(255).optional().default(""),
  ward: z.string().trim().max(80).optional().default(""),
  notes: z.string().trim().max(1000).optional().default(""),
});

export const ListBookingsFilterSchema = z.object({
  status: z.enum(BOOKING_STATUSES).optional(),
  search: z.string().trim().max(120).optional(),
  branchId: z.uuid("Invalid branch.").optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

export type CreateBookingInput = z.infer<typeof CreateBookingInputSchema>;
export type ListBookingsFilter = z.infer<typeof ListBookingsFilterSchema>;

export interface Booking {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  customer_id: string;
  service_id: string | null;
  reference: string;
  status: BookingStatus;
  amount_minor: number;
  currency: string;
  scheduled_at: string | null;
  address: string | null;
  ward: string | null;
  notes: string | null;
  created_at: string;
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

function toBooking(row: Record<string, unknown>): Booking {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    branch_id: (row.branch_id as string | null) ?? null,
    customer_id: String(row.customer_id ?? ""),
    service_id: (row.service_id as string | null) ?? null,
    reference: String(row.reference ?? ""),
    status: row.status as BookingStatus,
    amount_minor: Number(row.amount_minor ?? 0),
    currency: String(row.currency ?? "TZS"),
    scheduled_at: (row.scheduled_at as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    ward: (row.ward as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    created_at: String(row.created_at ?? ""),
  };
}

/** Pure reference builder: PREFIX + (1000 + existingCount). */
export function buildBookingReference(prefix: string, existingCount: number): string {
  return `${prefix}${1000 + existingCount}`;
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = "code" in err ? String((err as { code: unknown }).code) : "";
  const msg = "message" in err ? String((err as { message: unknown }).message) : "";
  return code === "23505" || (/duplicate key/i.test(msg) && /reference/i.test(msg));
}

async function nextBookingReference(client: SupabaseClient, tenantId: string): Promise<string> {
  const { data: settings } = await client
    .from("business_settings")
    .select("booking_prefix")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const prefix = ((settings as { booking_prefix?: unknown } | null)?.booking_prefix as string) || "BK-";
  const { count } = await client
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  return buildBookingReference(prefix, count ?? 0);
}

export async function createBooking(
  tenantId: string,
  userId: string,
  rawInput: unknown,
  db?: SupabaseClient,
): Promise<Booking> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "bookings:create", db);
  const parsed = CreateBookingInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
  const input = parsed.data;
  const client = dbOrAdmin(db);
  await assertWithinLimits(tenantId, "bookingsPerMonth", client);

  try {
    // Verify customer belongs to this tenant.
    const { data: customer, error: customerError } = await client
      .from("customers")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", input.customerId)
      .is("deleted_at", null)
      .maybeSingle();
    if (customerError) throw customerError;
    if (!customer) throw new AppError("The selected customer could not be found. Please refresh and try again.");

    if (input.serviceId) {
      const { data: service, error: serviceError } = await client
        .from("services")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("id", input.serviceId)
        .is("deleted_at", null)
        .maybeSingle();
      if (serviceError) throw serviceError;
      if (!service) throw new AppError("The selected service could not be found. Please refresh and try again.");
    }

    let reference = await nextBookingReference(client, tenantId);
    let row: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await client
        .from("bookings")
        .insert({
          tenant_id: tenantId,
          branch_id: input.branchId ?? null,
          customer_id: input.customerId,
          service_id: input.serviceId ?? null,
          reference,
          status: "NEW",
          amount_minor: input.amountMinor,
          currency: input.currency,
          scheduled_at: input.scheduledAt || null,
          address: input.address || null,
          ward: input.ward || null,
          notes: input.notes || null,
        })
        .select()
        .single();
      if (!error) {
        row = data as Record<string, unknown>;
        break;
      }
      if (isUniqueViolation(error) && attempt < 2) {
        reference = await nextBookingReference(client, tenantId);
        continue;
      }
      throw error;
    }
    if (!row) throw new AppError("This booking reference already exists. Please try again.");
    const booking = toBooking(row);

    await writeAudit(
      { tenantId, userId, action: "booking.created", entity: "booking", entityId: booking.id, metadata: { reference: booking.reference } },
      { throwOnError: false },
      client,
    );
    return booking;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (isUniqueViolation(err)) {
      throw new AppError("This booking reference already exists. Please try again.");
    }
    throw new AppError(humanizeDbError(err, "Could not create this booking"));
  }
}

export async function getBooking(
  tenantId: string,
  userId: string,
  bookingIdOrReference: string,
  db?: SupabaseClient,
): Promise<Booking> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "bookings:read", db);
  const identifier = (bookingIdOrReference ?? "").trim();
  if (!identifier) throw new AppError("Invalid booking.");
  const client = dbOrAdmin(db);
  const isUuid = z.uuid("Invalid booking.").safeParse(identifier).success;

  try {
    let query = client
      .from("bookings")
      .select("*")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null);
    query = isUuid ? query.eq("id", identifier) : query.eq("reference", identifier);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) throw new AppError("We could not find that booking.");
    return toBooking(data as Record<string, unknown>);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load this booking"));
  }
}

/** Explicit reference lookup — reuses the same internals as getBooking. */
export async function getBookingByReference(
  tenantId: string,
  userId: string,
  reference: string,
  db?: SupabaseClient,
): Promise<Booking> {
  const ref = (reference ?? "").trim();
  if (!ref) throw new AppError("Invalid booking.");
  return getBooking(tenantId, userId, ref, db);
}

export async function listBookings(
  tenantId: string,
  userId: string,
  rawFilter: unknown = {},
  db?: SupabaseClient,
): Promise<Booking[]> {
  checkIds(tenantId, userId);
  await requirePermission(tenantId, userId, "bookings:read", db);
  const parsed = ListBookingsFilterSchema.safeParse(rawFilter);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid filter.");
  const f = parsed.data;
  const client = dbOrAdmin(db);

  try {
    let query = client
      .from("bookings")
      .select("*")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200);
    if (f.status) query = query.eq("status", f.status);
    if (f.branchId) query = query.eq("branch_id", f.branchId);
    if (f.search) {
      const s = f.search.replace(/[%_]/g, "");
      query = query.or(`reference.ilike.%${s}%,address.ilike.%${s}%,ward.ilike.%${s}%`);
    }
    if (f.from) query = query.gte("scheduled_at", f.from);
    if (f.to) query = query.lte("scheduled_at", f.to);
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map(toBooking);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load bookings"));
  }
}

export async function transitionBooking(
  tenantId: string,
  userId: string,
  role: string,
  bookingIdOrReference: string,
  rawTo: unknown,
  db?: SupabaseClient,
): Promise<Booking> {
  checkIds(tenantId, userId);
  // Cancelling needs bookings:cancel; every other move needs bookings:update.
  const toParsed = z.enum(BOOKING_STATUSES, { message: "Choose a valid booking status." }).safeParse(rawTo);
  if (!toParsed.success) throw new AppError(toParsed.error.issues[0]?.message ?? "Invalid status.");
  const to = toParsed.data;
  await requirePermission(tenantId, userId, to === "CANCELLED" ? "bookings:cancel" : "bookings:update", db);
  const identifier = (bookingIdOrReference ?? "").trim();
  if (!identifier) throw new AppError("Invalid booking.");
  const client = dbOrAdmin(db);
  const isUuid = z.uuid("Invalid booking.").safeParse(identifier).success;

  try {
    let lookup = client
      .from("bookings")
      .select("*")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null);
    lookup = isUuid ? lookup.eq("id", identifier) : lookup.eq("reference", identifier);
    const { data: current, error: readError } = await lookup.maybeSingle();
    if (readError) throw readError;
    if (!current) throw new AppError("We could not find that booking.");
    const currentRow = current as Record<string, unknown>;
    const resolvedId = String(currentRow.id ?? identifier);
    const from = currentRow.status as BookingStatus;
    if (!isBookingStatus(from)) throw new AppError("This booking has an unknown status. Ask support for help.");
    assertTransitionAllowed(from, to);

    const { data, error } = await client
      .from("bookings")
      .update({ status: to })
      .eq("tenant_id", tenantId)
      .eq("id", resolvedId)
      .select()
      .single();
    if (error) throw error;
    const booking = toBooking(data as Record<string, unknown>);

    await writeAudit(
      { tenantId, userId, action: "booking.transition", entity: "booking", entityId: booking.id, metadata: { from, to, role } },
      { throwOnError: false },
      client,
    );

    // Best-effort WhatsApp automation — never breaks the transition.
    if (to === "CONFIRMED") {
      try {
        const { triggerAutomationEvent } = await import("@/services/whatsapp-automations.service");
        await triggerAutomationEvent(tenantId, "booking.confirmed", {
          customerId: booking.customer_id,
          bookingReference: booking.reference,
          params: { bookingReference: booking.reference },
        });
      } catch {
        // Automation is fire-and-forget.
      }
    }
    return booking;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not update this booking"));
  }
}

/** Explicit reference transition — reuses the same internals as transitionBooking. */
export async function transitionBookingByReference(
  tenantId: string,
  userId: string,
  role: string,
  reference: string,
  rawTo: unknown,
  db?: SupabaseClient,
): Promise<Booking> {
  const ref = (reference ?? "").trim();
  if (!ref) throw new AppError("Invalid booking.");
  return transitionBooking(tenantId, userId, role, ref, rawTo, db);
}
