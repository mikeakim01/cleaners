import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, humanizeDbError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/server/supabase-admin";
import { writeAudit } from "@/services/audit.service";
import { requirePermission } from "@/services/rbac.service";

export const REVIEW_SOURCES = ["portal", "public", "whatsapp", "staff"] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];

const REVIEWABLE_STATUSES = ["COMPLETED", "PAYMENT_PENDING", "PAID"] as const;

export const CreateReviewInputSchema = z.object({
  bookingId: z.uuid("Invalid booking.").optional(),
  bookingReference: z.string().trim().min(1, "Enter a booking reference.").max(60).optional(),
  rating: z.number().int("Rating must be a whole number.").min(1, "Rating must be between 1 and 5.").max(5, "Rating must be between 1 and 5."),
  comment: z.string().trim().max(1000, "Keep your review under 1000 characters.").optional().default(""),
});

export type CreateReviewInput = z.infer<typeof CreateReviewInputSchema>;

export const ListReviewsFilterSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
});

export type ReviewActor = { kind: "staff"; userId: string } | { kind: "portal"; customerId: string };

export interface Review {
  id: string;
  tenant_id: string;
  booking_id: string;
  customer_id: string;
  rating: number;
  comment: string | null;
  source: string;
  response: string | null;
  responded_by: string | null;
  responded_at: string | null;
  published: boolean;
  created_at: string;
  customer_name?: string;
  booking_reference?: string;
}

function dbOrAdmin(db?: SupabaseClient): SupabaseClient {
  return db ?? getSupabaseAdmin();
}

function checkTenant(tenantId: string): void {
  const parsed = z.uuid("Invalid business.").safeParse(tenantId);
  if (!parsed.success) throw new AppError("Invalid business.");
}

function toReview(row: Record<string, unknown>): Review {
  const customer = row.customers as { full_name?: unknown } | null;
  const booking = row.bookings as { reference?: unknown } | null;
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    booking_id: String(row.booking_id),
    customer_id: String(row.customer_id),
    rating: Number(row.rating),
    comment: (row.comment as string | null) ?? null,
    source: String(row.source ?? ""),
    response: (row.response as string | null) ?? null,
    responded_by: (row.responded_by as string | null) ?? null,
    responded_at: (row.responded_at as string | null) ?? null,
    published: Boolean(row.published),
    created_at: String(row.created_at ?? ""),
    ...(customer?.full_name ? { customer_name: String(customer.full_name) } : {}),
    ...(booking?.reference ? { booking_reference: String(booking.reference) } : {}),
  };
}

export async function createReview(
  tenantId: string,
  actor: ReviewActor,
  rawInput: unknown,
  source: ReviewSource = "portal",
  db?: SupabaseClient,
): Promise<Review> {
  checkTenant(tenantId);
  const parsed = CreateReviewInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check your review and try again.");
  const input = parsed.data;
  const identifier = (input.bookingId ?? input.bookingReference ?? "").trim();
  if (!identifier) throw new AppError("Enter a booking reference.");
  const client = dbOrAdmin(db);

  if (actor.kind === "staff") {
    const idParsed = z.uuid("Invalid user. Please sign in again.").safeParse(actor.userId);
    if (!idParsed.success) throw new AppError("Invalid user. Please sign in again.");
  } else {
    const idParsed = z.uuid("Invalid customer.").safeParse(actor.customerId);
    if (!idParsed.success) throw new AppError("Invalid customer.");
  }

  try {
    const isUuid = z.uuid("Invalid booking.").safeParse(identifier).success;
    let query = client
      .from("bookings")
      .select("id, tenant_id, customer_id, status, reference")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null);
    query = isUuid ? query.eq("id", identifier) : query.eq("reference", identifier);
    const { data: bookingData, error: bookingError } = await query.maybeSingle();
    if (bookingError) throw bookingError;
    if (!bookingData) throw new AppError("We could not find that booking.");
    const booking = bookingData as { id: string; customer_id: string; status: string };

    if (actor.kind === "portal" && booking.customer_id !== actor.customerId) {
      throw new AppError("We could not find that booking.");
    }

    if (!(REVIEWABLE_STATUSES as readonly string[]).includes(booking.status)) {
      throw new AppError("Reviews can only be left after the cleaning is done.");
    }

    const { data: existing, error: dupError } = await client
      .from("reviews")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("booking_id", booking.id)
      .limit(1);
    if (dupError) throw dupError;
    if (existing && existing.length > 0) {
      throw new AppError("A review already exists for this booking.");
    }

    const { data, error } = await client
      .from("reviews")
      .insert({
        tenant_id: tenantId,
        booking_id: booking.id,
        customer_id: booking.customer_id,
        rating: input.rating,
        comment: input.comment || null,
        source,
        published: true,
      })
      .select()
      .single();
    if (error) throw error;
    const review = toReview(data as Record<string, unknown>);

    await writeAudit(
      {
        tenantId,
        userId: actor.kind === "staff" ? actor.userId : actor.customerId,
        action: "review.created",
        entity: "review",
        entityId: review.id,
        metadata: { bookingId: booking.id, rating: input.rating, source },
      },
      { throwOnError: false },
      client,
    );
    return review;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not submit this review"));
  }
}

export async function listReviews(
  tenantId: string,
  userId: string,
  rawFilter: unknown = {},
  db?: SupabaseClient,
): Promise<Review[]> {
  checkTenant(tenantId);
  const idParsed = z.uuid("Invalid user. Please sign in again.").safeParse(userId);
  if (!idParsed.success) throw new AppError("Invalid user. Please sign in again.");
  await requirePermission(tenantId, userId, "reviews:read", db);
  const filterParsed = ListReviewsFilterSchema.safeParse(rawFilter ?? {});
  if (!filterParsed.success) throw new AppError(filterParsed.error.issues[0]?.message ?? "Invalid filter.");
  const client = dbOrAdmin(db);

  try {
    let query = client
      .from("reviews")
      .select("*, customers!inner(full_name), bookings(reference)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (filterParsed.data.rating !== undefined) query = query.eq("rating", filterParsed.data.rating);
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map(toReview);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load reviews"));
  }
}

export const RespondToReviewInputSchema = z.object({
  reviewId: z.uuid("Invalid review."),
  response: z.string().trim().min(1, "Write a response first.").max(1000, "Keep your response under 1000 characters."),
});

export async function respondToReview(
  tenantId: string,
  userId: string,
  rawInput: unknown,
  db?: SupabaseClient,
): Promise<Review> {
  checkTenant(tenantId);
  const idParsed = z.uuid("Invalid user. Please sign in again.").safeParse(userId);
  if (!idParsed.success) throw new AppError("Invalid user. Please sign in again.");
  await requirePermission(tenantId, userId, "reviews:respond", db);
  const parsed = RespondToReviewInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check your response and try again.");
  const client = dbOrAdmin(db);

  try {
    const { data, error } = await client
      .from("reviews")
      .update({
        response: parsed.data.response,
        responded_by: userId,
        responded_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", parsed.data.reviewId)
      .select()
      .single();
    if (error) throw error;
    if (!data) throw new AppError("We could not find that review.");
    const review = toReview(data as Record<string, unknown>);

    await writeAudit(
      { tenantId, userId, action: "review.responded", entity: "review", entityId: review.id, metadata: {} },
      { throwOnError: false },
      client,
    );
    return review;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not save this response"));
  }
}

export async function getReviewSummary(
  tenantId: string,
  userId: string,
  db?: SupabaseClient,
): Promise<{ avg: number; count: number }> {
  checkTenant(tenantId);
  const idParsed = z.uuid("Invalid user. Please sign in again.").safeParse(userId);
  if (!idParsed.success) throw new AppError("Invalid user. Please sign in again.");
  await requirePermission(tenantId, userId, "reviews:read", db);
  const client = dbOrAdmin(db);
  try {
    const { data, error } = await client
      .from("reviews")
      .select("rating")
      .eq("tenant_id", tenantId)
      .eq("published", true);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ rating: number }>;
    const count = rows.length;
    const avg = count === 0 ? 0 : rows.reduce((s, r) => s + Number(r.rating ?? 0), 0) / count;
    return { avg: Math.round(avg * 10) / 10, count };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load the review summary"));
  }
}
