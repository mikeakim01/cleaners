import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, humanizeDbError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/server/supabase-admin";
import { writeAudit } from "@/services/audit.service";
import { assertJobAssignee } from "@/services/jobs.service";
import { requirePermission } from "@/services/rbac.service";

export const PHOTO_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export type PhotoMime = (typeof PHOTO_MIMES)[number];
export type PhotoKind = "before" | "after";

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_BUCKET = "tenant-files";

export const UploadJobPhotoInputSchema = z.object({
  jobId: z.uuid("Invalid job."),
  kind: z.enum(["before", "after"], { message: "Choose before or after." }),
  contentBase64: z.string().trim().min(1, "Photo is required."),
  mime: z.string().trim().min(1, "Photo format is required."),
});

export interface JobPhoto {
  id: string;
  kind: PhotoKind;
  mime: string;
  createdAt: string;
  url: string;
}

/** Pure: storage path for a job photo. Before/after is encoded in the filename. */
export function buildPhotoPath(tenantId: string, jobId: string, kind: PhotoKind, ts: number): string {
  return `${tenantId}/${jobId}/${kind}-${ts}.jpg`;
}

/** Pure: throws the human message unless the mime is an allowed photo type. */
export function assertPhotoMime(mime: unknown): asserts mime is PhotoMime {
  if (typeof mime !== "string" || !(PHOTO_MIMES as readonly string[]).includes(mime)) {
    throw new AppError("Photos must be JPEG, PNG, or WebP.");
  }
}

/** Pure: throws the human message when the byte size exceeds the 5 MB cap. */
export function assertPhotoSize(sizeBytes: number): void {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    throw new AppError("Photos must be smaller than 5 MB.");
  }
  if (sizeBytes > MAX_PHOTO_BYTES) {
    throw new AppError("Photos must be smaller than 5 MB.");
  }
}

/** Pure: derives before/after from the storage filename. */
export function photoKindFromPath(storagePath: string): PhotoKind {
  const filename = storagePath.split("/").pop() ?? "";
  return filename.startsWith("after-") ? "after" : "before";
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

async function assertCallerAssigned(
  client: SupabaseClient,
  tenantId: string,
  userId: string,
  role: string,
  jobId: string,
): Promise<void> {
  const { data: employee, error: empError } = await client
    .from("employees")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (empError) throw empError;
  const callerEmployeeId = ((employee as { id?: unknown } | null)?.id as string | undefined) ?? null;

  const { data: assignments, error: assignError } = await client
    .from("job_assignments")
    .select("employee_id")
    .eq("tenant_id", tenantId)
    .eq("job_id", jobId)
    .is("deleted_at", null);
  if (assignError) throw assignError;
  const assigned = ((assignments ?? []) as Array<{ employee_id: string }>).map((a) => a.employee_id);
  // Reuses the shared ownership check from jobs.service — same human message.
  assertJobAssignee(role, callerEmployeeId, assigned);
}

async function assertJobInTenant(client: SupabaseClient, tenantId: string, jobId: string): Promise<void> {
  const { data, error } = await client
    .from("jobs")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError("We could not find that job.");
}

/** Upload a before/after job photo to the private bucket and record it in files. */
export async function uploadJobPhoto(
  tenantId: string,
  userId: string,
  rawInput: unknown,
  db?: SupabaseClient,
): Promise<{ id: string; kind: PhotoKind; sizeBytes: number }> {
  checkIds(tenantId, userId);
  const role = await requirePermission(tenantId, userId, "bookings:update", db);
  const parsed = UploadJobPhotoInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Please check the photo and try again.");
  const { jobId, kind, contentBase64, mime } = parsed.data;
  assertPhotoMime(mime);
  const client = dbOrAdmin(db);

  let bytes: Buffer;
  try {
    bytes = Buffer.from(contentBase64, "base64");
  } catch {
    throw new AppError("This photo could not be read. Please try again.");
  }
  if (bytes.length === 0) throw new AppError("Photo is required.");
  assertPhotoSize(bytes.length);

  try {
    await assertJobInTenant(client, tenantId, jobId);
    await assertCallerAssigned(client, tenantId, userId, role, jobId);

    const storagePath = buildPhotoPath(tenantId, jobId, kind, Date.now());
    const { error: uploadError } = await client.storage
      .from(PHOTO_BUCKET)
      .upload(storagePath, bytes, { contentType: mime, upsert: false });
    if (uploadError) throw uploadError;

    const { data, error: insertError } = await client
      .from("files")
      .insert({
        tenant_id: tenantId,
        entity: "job",
        entity_id: jobId,
        kind: "photo",
        storage_path: storagePath,
        mime,
        size_bytes: bytes.length,
        captured_by: userId,
      })
      .select("id")
      .single();
    if (insertError) throw insertError;
    const id = String((data as { id: unknown }).id);

    await writeAudit(
      { tenantId, userId, action: "job.photo_added", entity: "job", entityId: jobId, metadata: { kind, fileId: id } },
      { throwOnError: false },
      client,
    );
    return { id, kind, sizeBytes: bytes.length };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not upload this photo"));
  }
}

/** List a job's photos with 1-hour signed URLs (bucket is private — no public URLs). */
export async function listJobPhotos(
  tenantId: string,
  userId: string,
  jobId: string,
  db?: SupabaseClient,
): Promise<JobPhoto[]> {
  checkIds(tenantId, userId);
  const role = await requirePermission(tenantId, userId, "bookings:read", db);
  const parsed = z.uuid("Invalid job.").safeParse(jobId);
  if (!parsed.success) throw new AppError("Invalid job.");
  const client = dbOrAdmin(db);

  try {
    await assertJobInTenant(client, tenantId, jobId);
    await assertCallerAssigned(client, tenantId, userId, role, jobId);

    const { data, error } = await client
      .from("files")
      .select("id, storage_path, mime, created_at")
      .eq("tenant_id", tenantId)
      .eq("entity", "job")
      .eq("entity_id", jobId)
      .eq("kind", "photo")
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(100);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ id: string; storage_path: string; mime: string; created_at: string }>;

    const photos: JobPhoto[] = [];
    for (const row of rows) {
      const { data: signed, error: signError } = await client.storage
        .from(PHOTO_BUCKET)
        .createSignedUrl(row.storage_path, 3600);
      if (signError || !signed?.signedUrl) continue;
      photos.push({
        id: row.id,
        kind: photoKindFromPath(row.storage_path),
        mime: row.mime,
        createdAt: row.created_at,
        url: signed.signedUrl,
      });
    }
    return photos;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(humanizeDbError(err, "Could not load job photos"));
  }
}
