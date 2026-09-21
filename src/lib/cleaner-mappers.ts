/**
 * Service-to-display mappers for the cleaner PWA (Phase 7).
 * All mapping lives here — never in components.
 */
import type {
  CleanerJob,
  CleanerPhoto,
  CleanerScheduleDay,
  JobPhotoKind,
} from "./cleaner-types";
import type { MyJob, ScheduleBucket } from "@/services/cleaner.service";
import type { JobPhoto } from "@/services/files.service";

export function mapMyJob(row: MyJob): CleanerJob {
  return {
    jobId: row.job.id,
    status: row.job.status.toLowerCase(),
    scheduledAt: row.job.scheduled_at ?? row.booking.scheduledAt,
    reference: row.booking.reference,
    customerName: row.booking.customerName,
    address: row.booking.address ?? "",
    ward: row.booking.ward ?? undefined,
    serviceName: row.booking.serviceName ?? "",
    customerPhone: row.booking.customerPhone ?? undefined,
    teamName: row.teamName ?? undefined,
    gateNotes: undefined,
    amountMinor: row.booking.amountMinor,
    currency: row.booking.currency,
    photos: { ...row.photos },
  };
}

export function mapSchedule(days: ScheduleBucket[]): CleanerScheduleDay[] {
  return days.map((d) => ({ date: d.date, jobs: d.jobs.map(mapMyJob) }));
}

function toPhotoKind(kind: string): JobPhotoKind {
  return kind === "after" ? "after" : "before";
}

export function mapJobPhoto(p: JobPhoto): CleanerPhoto {
  return {
    id: p.id,
    kind: toPhotoKind(p.kind),
    createdAt: p.createdAt,
    url: p.url,
  };
}
