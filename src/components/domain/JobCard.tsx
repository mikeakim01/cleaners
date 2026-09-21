import { ArrowRight } from "lucide-react";
import { Avatar, Button, StatusBadge } from "@/components/ui";
import type { StatusKind } from "@/components/ui/StatusBadge";
import { t, type TranslationKey } from "@/i18n";
import type { Job } from "@/lib/trackf-types";

export interface JobCardProps {
  job: Job;
  onAction?: (job: Job) => void;
  actionPending?: boolean;
}

const KIND_BY_STATUS: Record<string, StatusKind> = {
  scheduled: "info",
  assigned: "confirmed",
  en_route: "in_progress",
  in_progress: "in_progress",
  completed: "completed",
  paid: "success",
  cancelled: "cancelled",
};

const LABEL_BY_STATUS: Record<string, TranslationKey> = {
  scheduled: "jobs.assignCrew",
  assigned: "jobs.advance",
  en_route: "jobs.advance",
  in_progress: "jobs.advance",
};

function statusKind(status: string): StatusKind {
  return KIND_BY_STATUS[status] ?? "pending";
}

export function JobCard({ job, onAction, actionPending = false }: JobCardProps) {
  const labelKey = LABEL_BY_STATUS[job.status] ?? "jobs.view";
  return (
    <article className="rounded-card border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-ink">
            {job.customerName ?? job.reference}
          </h3>
          <p className="truncate text-sm text-muted">
            {job.serviceName ?? job.bookingReference ?? ""}
          </p>
        </div>
        <StatusBadge status={statusKind(job.status)} label={job.status} />
      </div>

      <dl className="mt-3 flex flex-col gap-1 text-sm">
        {job.slot ? (
          <div className="flex justify-between gap-2">
            <dt className="text-muted">{t("jobs.colSlot")}</dt>
            <dd className="font-medium tabular-nums">{job.slot}</dd>
          </div>
        ) : null}
        {job.address ? (
          <div className="flex justify-between gap-2">
            <dt className="text-muted">{t("jobs.colAddress")}</dt>
            <dd className="truncate font-medium">{job.address}</dd>
          </div>
        ) : null}
        {job.teamName ? (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted">{t("employees.team")}</dt>
            <dd className="flex items-center gap-2 font-medium">
              <Avatar name={job.teamName} size="sm" />
              {job.teamName}
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="truncate text-xs tabular-nums text-muted">{job.reference}</span>
        <Button
          size="sm"
          onClick={() => onAction?.(job)}
          loading={actionPending}
          aria-label={`${t(labelKey)}: ${job.reference}`}
        >
          {t(labelKey)}
          <ArrowRight size={18} aria-hidden="true" />
        </Button>
      </div>
    </article>
  );
}
