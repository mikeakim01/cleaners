"use client";

import { Drawer } from "@/components/ui";
import { t } from "@/i18n";
import { useJobPhotos } from "@/hooks/useCleanerJobs";
import type { CleanerJob } from "@/lib/cleaner-types";
import { formatDate, formatPhone255 } from "@/lib/format";
import { ContactButtons, formatSlot } from "./CleanerJobCard";
import { JobActionButton } from "./JobActionButton";
import { PhotoCapture } from "./PhotoCapture";

export function JobDetailDrawer({
  tenantSlug,
  job,
  onClose,
}: {
  tenantSlug: string;
  job: CleanerJob | null;
  onClose: () => void;
}) {
  const { before, after } = useJobPhotos(
    tenantSlug,
    job?.jobId ?? "__none__",
  );

  return (
    <Drawer
      open={job !== null}
      onClose={onClose}
      title={job ? `${t("cleaner.jobDetails")} · ${job.reference}` : t("cleaner.jobDetails")}
    >
      {job ? (
        <div className="flex flex-col gap-5">
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-muted">{t("cleaner.customer")}</dt>
              <dd className="text-right font-medium text-ink">
                {job.customerName || "—"}
              </dd>
            </div>
            {job.customerPhone ? (
              <div className="flex justify-between gap-2">
                <dt className="text-muted">{t("cleaner.phone")}</dt>
                <dd className="font-medium tabular-nums text-ink">
                  {formatPhone255(job.customerPhone)}
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-2">
              <dt className="text-muted">{t("cleaner.service")}</dt>
              <dd className="text-right font-medium text-ink">
                {job.serviceName || "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">{t("cleaner.address")}</dt>
              <dd className="text-right font-medium text-ink">
                {job.address || "—"}
              </dd>
            </div>
            {job.ward ? (
              <div className="flex justify-between gap-2">
                <dt className="text-muted">{t("cleaner.ward")}</dt>
                <dd className="font-medium text-ink">{job.ward}</dd>
              </div>
            ) : null}
            {job.teamName ? (
              <div className="flex justify-between gap-2">
                <dt className="text-muted">{t("cleaner.team")}</dt>
                <dd className="font-medium text-ink">{job.teamName}</dd>
              </div>
            ) : null}
            {job.scheduledAt ? (
              <div className="flex justify-between gap-2">
                <dt className="text-muted">{t("cleaner.scheduledFor")}</dt>
                <dd className="font-medium tabular-nums text-ink">
                  {formatSlot(job.scheduledAt) || formatDate(job.scheduledAt)}
                </dd>
              </div>
            ) : null}
            {job.gateNotes ? (
              <div className="flex flex-col gap-1">
                <dt className="text-muted">{t("cleaner.gateNotes")}</dt>
                <dd className="font-medium text-ink">{job.gateNotes}</dd>
              </div>
            ) : null}
          </dl>

          <ContactButtons job={job} />
          <PhotoCapture tenantSlug={tenantSlug} jobId={job.jobId} />
          <JobActionButton
            tenantSlug={tenantSlug}
            job={job}
            beforeCount={before + job.photos.before}
            afterCount={after + job.photos.after}
          />
        </div>
      ) : null}
    </Drawer>
  );
}
