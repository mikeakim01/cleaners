/**
 * Cleaner PWA display types (Phase 7).
 * UI-facing camelCase shapes; service-to-UI mapping lives in
 * cleaner-mappers.ts. No business rules here.
 */

export type JobPhotoKind = "before" | "after";

export interface CleanerJobPhotoCounts {
  before: number;
  after: number;
}

export interface CleanerJob {
  jobId: string;
  /** Lowercase UI status: scheduled|assigned|en_route|arrived|in_progress|completed|cancelled */
  status: string;
  scheduledAt: string | null;
  reference: string;
  customerName: string;
  address: string;
  ward?: string;
  serviceName: string;
  customerPhone?: string;
  teamName?: string;
  gateNotes?: string;
  /** Booking total in minor units, when known. Job value — NOT a payout. */
  amountMinor?: number;
  currency?: string;
  /** Server-confirmed photo counts. */
  photos: CleanerJobPhotoCounts;
}

export interface CleanerScheduleDay {
  /** YYYY-MM-DD */
  date: string;
  jobs: CleanerJob[];
}

export interface CleanerPhoto {
  id: string;
  kind: JobPhotoKind;
  createdAt: string;
  url: string;
}

export interface UploadJobPhotoInput {
  jobId: string;
  kind: JobPhotoKind;
  contentBase64: string;
  mime: string;
}

/** Roles allowed into the cleaner mobile shell. */
export const CLEANER_ROLES = ["CLEANER", "DRIVER", "SUPERVISOR"] as const;

export function isCleanerRole(role: string): boolean {
  return (CLEANER_ROLES as readonly string[]).includes(role);
}
