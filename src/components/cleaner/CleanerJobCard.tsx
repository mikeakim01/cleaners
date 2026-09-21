"use client";

import { MessageCircle, Navigation, Phone } from "lucide-react";
import { StatusBadge } from "@/components/ui";
import type { StatusKind } from "@/components/ui/StatusBadge";
import { t } from "@/i18n";
import type { CleanerJob } from "@/lib/cleaner-types";
import { formatDate } from "@/lib/format";
import { useJobPhotos } from "@/hooks/useCleanerJobs";
import { JobActionButton } from "./JobActionButton";
import { ShiftProgress } from "./ShiftProgress";

const KIND_BY_STATUS: Record<string, StatusKind> = {
  scheduled: "info",
  assigned: "confirmed",
  en_route: "in_progress",
  arrived: "in_progress",
  in_progress: "in_progress",
  completed: "completed",
  cancelled: "cancelled",
};

function digitsOnly(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

export function contactLinks(job: CleanerJob): {
  tel: string | null;
  whatsapp: string | null;
  maps: string | null;
} {
  const digits = job.customerPhone ? digitsOnly(job.customerPhone) : "";
  const tel = digits ? `tel:+${digits}` : null;
  const whatsapp = digits
    ? `https://wa.me/${digits}?text=${encodeURIComponent(`Hello ${job.customerName || ""}, this is your cleaner regarding job ${job.reference}.`.trim())}`
    : null;
  const maps = job.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}`
    : null;
  return { tel, whatsapp, maps };
}

export function formatSlot(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Dar_es_Salaam",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return `${formatDate(d)} · ${time}`;
}

export function ContactButtons({ job }: { job: CleanerJob }) {
  const { tel, whatsapp, maps } = contactLinks(job);
  const linkClass =
    "inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-input border border-border bg-surface px-3 text-sm font-medium text-ink";
  return (
    <div className="flex gap-2" role="group" aria-label={t("cleaner.contact")}>
      {tel ? (
        <a href={tel} className={linkClass} aria-label={`${t("cleaner.call")}: ${job.customerName}`}>
          <Phone size={18} aria-hidden="true" />
          {t("cleaner.call")}
        </a>
      ) : null}
      {whatsapp ? (
        <a
          href={whatsapp}
          target="_blank"
          rel="noreferrer"
          className={linkClass}
          aria-label={`${t("cleaner.whatsapp")}: ${job.customerName}`}
        >
          <MessageCircle size={18} aria-hidden="true" />
          {t("cleaner.whatsapp")}
        </a>
      ) : null}
      {maps ? (
        <a
          href={maps}
          target="_blank"
          rel="noreferrer"
          className={linkClass}
          aria-label={`${t("cleaner.directions")}: ${job.address}`}
        >
          <Navigation size={18} aria-hidden="true" />
          {t("cleaner.directions")}
        </a>
      ) : null}
    </div>
  );
}

export function CleanerJobCard({
  tenantSlug,
  job,
  onSelect,
}: {
  tenantSlug: string;
  job: CleanerJob;
  onSelect: (job: CleanerJob) => void;
}) {
  const { before, after } = useJobPhotos(tenantSlug, job.jobId);
  const status = job.status.toLowerCase();
  const slot = formatSlot(job.scheduledAt);

  return (
    <article className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-ink">
            {job.customerName || job.reference}
          </h3>
          <p className="truncate text-sm text-muted">
            {job.serviceName || job.reference}
          </p>
        </div>
        <StatusBadge status={KIND_BY_STATUS[status] ?? "pending"} label={status} />
      </div>

      {slot ? (
        <p className="text-sm font-medium tabular-nums text-ink">{slot}</p>
      ) : null}
      {job.address ? (
        <p className="truncate text-sm text-muted">{job.address}</p>
      ) : null}

      <ShiftProgress status={status} />
      <ContactButtons job={job} />
      <JobActionButton
        tenantSlug={tenantSlug}
        job={job}
        beforeCount={before + job.photos.before}
        afterCount={after + job.photos.after}
      />
      <button
        type="button"
        onClick={() => onSelect(job)}
        className="min-h-11 rounded-input text-sm font-medium text-primary underline-offset-2 hover:underline"
      >
        {t("cleaner.viewDetails")}
      </button>
    </article>
  );
}
