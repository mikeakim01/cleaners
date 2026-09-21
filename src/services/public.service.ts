import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, humanizeDbError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/server/supabase-admin";
import { writeAudit } from "@/services/audit.service";
import { buildBookingReference } from "@/services/bookings.service";

export const TANZANIA_PHONE_REGEX = /^\+255\d{9}$/;

export const TIME_SLOTS = ["morning", "midday", "afternoon", "evening"] as const;
export type TimeSlot = (typeof TIME_SLOTS)[number];

/** Pure slot -> hour (EAT wall time) mapping, exported for unit tests. */
export function mapTimeSlotToHour(slot: TimeSlot): number {
  switch (slot) {
    case "morning":
      return 9;
    case "midday":
      return 12;
    case "afternoon":
      return 14;
    case "evening":
      return 16;
  }
}

/** Pure estimate: service base + add-on bases (all integer minor units). */
export function estimateBookingTotal(baseMinor: number, addonBases: readonly number[]): number {
  return baseMinor + addonBases.reduce((sum, v) => sum + v, 0);
}

const SlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "We could not find that business.");

function todayEat(): string {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

function addDaysEat(days: number): string {
  const [y, m, d] = todayEat().split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000);
  return day.toISOString().slice(0, 10);
}

/** Pure scheduled-date guard — exported for unit tests. Throws human errors. */
export function assertPublicScheduledDate(scheduledDate: string): void {
  if (scheduledDate <= todayEat()) {
    throw new AppError("Please choose a future date for your cleaning.");
  }
  if (scheduledDate > addDaysEat(60)) {
    throw new AppError("Bookings can only be made up to 60 days in advance.");
  }
}

export const PublicBookingInputSchema = z.object({
  serviceId: z.uuid("Please choose a service."),
  addOnServiceIds: z.array(z.uuid("Invalid add-on service.")).max(5, "Choose at most 5 add-ons.").optional().default([]),
  branchId: z.uuid("Invalid branch.").optional(),
  propertyType: z.enum(["house", "apartment", "office", "other"], { message: "Choose a property type." }),
  bedrooms: z.number().int().min(0).max(20).optional().default(0),
  bathrooms: z.number().int().min(0).max(20).optional().default(0),
  livingRooms: z.number().int().min(0).max(20).optional().default(0),
  areaSqm: z.number().min(0).max(100000).optional().default(0),
  floorLevel: z.string().trim().max(120).optional().default(""),
  accessInstructions: z.string().trim().max(1000).optional().default(""),
  scheduledDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date."),
  timeSlot: z.enum(TIME_SLOTS, { message: "Choose a time slot." }),
  fullName: z.string().trim().min(2, "Please enter your full name.").max(120),
  phone: z.string().trim().regex(TANZANIA_PHONE_REGEX, "Phone must be a Tanzanian number like +255712345678."),
  address: z.string().trim().min(2, "Please enter your address.").max(255),
  ward: z.string().trim().max(80).optional().default(""),
  notes: z.string().trim().max(1000).optional().default(""),
});

export type PublicBookingInput = z.infer<typeof PublicBookingInputSchema>;

export interface PublicBranch {
  id: string;
  name: string;
  ward: string | null;
  address: string | null;
}

export interface PublicService {
  id: string;
  name: string;
  description: string | null;
  pricing_model: string;
  base_price_minor: number;
  unit_price_minor: number;
  active: boolean;
}

export interface PublicReviewQuote {
  customerName: string;
  rating: number;
  comment: string;
}

export interface PublicTenant {
  id: string;
  slug: string;
  name: string;
  phone_e164: string | null;
  primary_color: string;
  logo_url: string | null;
  address: string | null;
  branches: PublicBranch[];
  services: PublicService[];
  reviewsSummary: { avg: number; count: number };
  reviews: PublicReviewQuote[];
}

export interface PublicBookingResult {
  reference: string;
  estimateMinor: number;
  scheduledAt: string;
}

function dbOrAdmin(db?: SupabaseClient): SupabaseClient {
  return db ?? getSupabaseAdmin();
}

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  phone_e164: string | null;
  primary_color: string;
  logo_url: string | null;
  suspended: boolean;
}

async function resolvePublicTenant(client: SupabaseClient, rawSlug: unknown): Promise<TenantRow> {
  const slugParsed = SlugSchema.safeParse(rawSlug);
  if (!slugParsed.success) throw new AppError("We could not find that business.");
  const { data, error } = await client
    .from("tenants")
    .select("id, slug, name, phone_e164, primary_color, logo_url, suspended")
    .eq("slug", slugParsed.data)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new AppError(humanizeDbError(error, "Could not load this business"));
  if (!data) throw new AppError("We could not find that business.");
  const tenant = data as TenantRow;
  if (tenant.suspended) throw new AppError("This business is not taking online bookings right now.");
  return tenant;
}

export async function getPublicTenant(rawSlug: unknown, db?: SupabaseClient): Promise<PublicTenant> {
  const client = dbOrAdmin(db);
  try {
    const tenant = await resolvePublicTenant(client, rawSlug);

    const [{ data: branches, error: branchError }, { data: services, error: serviceError }] = await Promise.all([
      client
        .from("branches")
        .select("id, name, ward, address")
        .eq("tenant_id", tenant.id)
        .eq("active", true)
        .is("deleted_at", null)
        .order("name"),
      client
        .from("services")
        .select("id, name, description, pricing_model, base_price_minor, unit_price_minor, active")
        .eq("tenant_id", tenant.id)
        .eq("active", true)
        .is("deleted_at", null)
        .order("name"),
    ]);
    if (branchError) throw branchError;
    if (serviceError) throw serviceError;

    let avg = 0;
    let count = 0;
    let quotes: PublicReviewQuote[] = [];
    try {
      const { data: reviews, error: reviewError } = await client
        .from("reviews")
        .select("rating, comment, customers(full_name)")
        .eq("tenant_id", tenant.id)
        .eq("published", true)
        .order("created_at", { ascending: false })
        .limit(50);
      if (reviewError) throw reviewError;
      const rows = (reviews ?? []) as Array<{
        rating: number;
        comment: string | null;
        customers: { full_name?: unknown } | null;
      }>;
      count = rows.length;
      if (count > 0) avg = rows.reduce((s, r) => s + Number(r.rating ?? 0), 0) / count;
      quotes = rows
        .filter((r) => (r.comment ?? "").trim().length > 0)
        .slice(0, 6)
        .map((r) => ({
          customerName:
            typeof r.customers?.full_name === "string" && r.customers.full_name.trim()
              ? r.customers.full_name
              : "Verified customer",
          rating: Number(r.rating ?? 5),
          comment: String(r.comment ?? ""),
        }));
    } catch {
      avg = 0;
      count = 0;
      quotes = [];
    }

    let businessAddress: string | null = null;
    try {
      const { data: settings } = await client
        .from("business_settings")
        .select("address")
        .eq("tenant_id", tenant.id)
        .maybeSingle();
      businessAddress = ((settings as { address?: unknown } | null)?.address as string) ?? null;
    } catch {
      businessAddress = null;
    }

    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      phone_e164: tenant.phone_e164,
      primary_color: tenant.primary_color,
      logo_url: tenant.logo_url,
      address: businessAddress,
      branches: ((branches ?? []) as Array<{ id: string; name: string; ward: string | null; address: string | null }>).map((b) => ({
        id: String(b.id),
        name: String(b.name),
        ward: b.ward ?? null,
        address: b.address ?? null,
      })),
      services: ((services ?? []) as Array<Record<string, unknown>>).map((s) => ({
        id: String(s.id),
        name: String(s.name),
        description: (s.description as string | null) ?? null,
        pricing_model: String(s.pricing_model),
        base_price_minor: Number(s.base_price_minor ?? 0),
        unit_price_minor: Number(s.unit_price_minor ?? 0),
        active: Boolean(s.active),
      })),
      reviewsSummary: { avg: Math.round(avg * 10) / 10, count },
      reviews: quotes,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load this business"));
  }
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
  const { count } = await client.from("bookings").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  return buildBookingReference(prefix, count ?? 0);
}

export async function createPublicBooking(
  rawSlug: unknown,
  rawInput: unknown,
  db?: SupabaseClient,
): Promise<PublicBookingResult> {
  const parsed = PublicBookingInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
  const input = parsed.data;

  assertPublicScheduledDate(input.scheduledDate);

  const client = dbOrAdmin(db);
  try {
    const tenant = await resolvePublicTenant(client, rawSlug);

    const wantedIds = [input.serviceId, ...input.addOnServiceIds];
    const { data: serviceRows, error: serviceError } = await client
      .from("services")
      .select("id, base_price_minor, active")
      .eq("tenant_id", tenant.id)
      .in("id", wantedIds)
      .is("deleted_at", null);
    if (serviceError) throw serviceError;
    const byId = new Map(((serviceRows ?? []) as Array<{ id: string; base_price_minor: number; active: boolean }>).map((s) => [String(s.id), s]));
    const main = byId.get(input.serviceId);
    if (!main || !main.active) throw new AppError("The selected service is not available right now.");
    const addonBases: number[] = [];
    for (const addonId of input.addOnServiceIds) {
      const addon = byId.get(addonId);
      if (!addon || !addon.active) throw new AppError("One of the selected add-ons is not available right now.");
      addonBases.push(Number(addon.base_price_minor ?? 0));
    }
    const estimate = estimateBookingTotal(Number(main.base_price_minor ?? 0), addonBases);

    if (input.branchId) {
      const { data: branch, error: branchError } = await client
        .from("branches")
        .select("id, active")
        .eq("tenant_id", tenant.id)
        .eq("id", input.branchId)
        .is("deleted_at", null)
        .maybeSingle();
      if (branchError) throw branchError;
      if (!branch) throw new AppError("The selected branch could not be found.");
      if (!(branch as { active: boolean }).active) throw new AppError("That branch is not available right now.");
    }

    const { data: existing, error: customerLookupError } = await client
      .from("customers")
      .select("id, full_name, address, ward")
      .eq("tenant_id", tenant.id)
      .eq("phone_e164", input.phone)
      .is("deleted_at", null)
      .maybeSingle();
    if (customerLookupError) throw customerLookupError;

    let customerId: string;
    if (existing) {
      customerId = String((existing as { id: string }).id);
      const patch: Record<string, unknown> = {};
      if (input.fullName && input.fullName !== (existing as { full_name: string }).full_name) patch.full_name = input.fullName;
      if (input.address) patch.address = input.address;
      if (input.ward !== undefined) patch.ward = input.ward || null;
      if (Object.keys(patch).length > 0) {
        await client.from("customers").update(patch).eq("tenant_id", tenant.id).eq("id", customerId);
      }
    } else {
      const { data: created, error: createError } = await client
        .from("customers")
        .insert({
          tenant_id: tenant.id,
          branch_id: input.branchId ?? null,
          full_name: input.fullName,
          phone_e164: input.phone,
          address: input.address,
          ward: input.ward || null,
        })
        .select("id")
        .single();
      if (createError) throw createError;
      customerId = String((created as { id: string }).id);
    }

    const hour = mapTimeSlotToHour(input.timeSlot);
    const scheduledAt = `${input.scheduledDate}T${String(hour).padStart(2, "0")}:00:00+03:00`;

    let reference = await nextBookingReference(client, tenant.id);
    let bookingId: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await client
        .from("bookings")
        .insert({
          tenant_id: tenant.id,
          branch_id: input.branchId ?? null,
          customer_id: customerId,
          service_id: input.serviceId,
          reference,
          status: "NEW",
          amount_minor: estimate,
          currency: "TZS",
          scheduled_at: scheduledAt,
          address: input.address,
          ward: input.ward || null,
          notes: input.notes || null,
          source: "public",
          property_snapshot: {
            propertyType: input.propertyType,
            bedrooms: input.bedrooms,
            bathrooms: input.bathrooms,
            livingRooms: input.livingRooms,
            areaSqm: input.areaSqm,
            floorLevel: input.floorLevel,
            accessInstructions: input.accessInstructions,
            timeSlot: input.timeSlot,
            addOnServiceIds: input.addOnServiceIds,
          },
        })
        .select("id")
        .single();
      if (!error) {
        bookingId = String((data as { id: string }).id);
        break;
      }
      if (isUniqueViolation(error) && attempt < 2) {
        reference = await nextBookingReference(client, tenant.id);
        continue;
      }
      throw error;
    }
    if (!bookingId) throw new AppError("This booking reference already exists. Please try again.");

    await writeAudit(
      {
        tenantId: tenant.id,
        userId: customerId,
        action: "booking.created",
        entity: "booking",
        entityId: bookingId,
        metadata: { reference, source: "public" },
      },
      { throwOnError: false },
      client,
    );

    return { reference, estimateMinor: estimate, scheduledAt };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (isUniqueViolation(err)) throw new AppError("This booking reference already exists. Please try again.");
    throw new AppError(humanizeDbError(err, "Could not create this booking"));
  }
}
