"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState, ErrorState, LoadingState, StatusBadge } from "@/components/ui";
import type { StatusKind } from "@/components/ui/StatusBadge";
import { t } from "@/i18n";
import { useCleanerSchedule } from "@/hooks/useCleanerJobs";
import type { CleanerJob } from "@/lib/cleaner-types";
import { formatDate } from "@/lib/format";
import { JobDetailDrawer } from "@/components/cleaner/JobDetailDrawer";
import { formatSlot } from "@/components/cleaner/CleanerJobCard";

const KIND_BY_STATUS: Record<string, StatusKind> = {
  scheduled: "info",
  assigned: "confirmed",
  en_route: "in_progress",
  arrived: "in_progress",
  in_progress: "in_progress",
  completed: "completed",
  cancelled: "cancelled",
};

function mondayOf(date: Date): Date {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ScheduleClient({ tenantSlug }: { tenantSlug: string }) {
  const [weekStartDate, setWeekStartDate] = useState(() => mondayOf(new Date()));
  const weekStart = toISODate(weekStartDate);
  const query = useCleanerSchedule(tenantSlug, weekStart);
  const [selected, setSelected] = useState<CleanerJob | null>(null);

  const days = useMemo(() => query.data ?? [], [query.data]);

  const shiftWeek = (delta: number) => {
    const d = new Date(weekStartDate);
    d.setDate(d.getDate() + delta);
    setWeekStartDate(mondayOf(d));
  };

  return (
    <div className="flex flex-col gap-3">
      <h1 className="font-heading text-xl font-bold text-ink">
        {t("cleaner.scheduleTitle")}
      </h1>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => shiftWeek(-7)}
          aria-label={t("cleaner.prevWeek")}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-input border border-border bg-surface text-ink"
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setWeekStartDate(mondayOf(new Date()))}
          className="min-h-11 rounded-input border border-border bg-surface px-3 text-sm font-medium text-ink"
        >
          {t("cleaner.thisWeek")} · {formatDate(weekStartDate)}
        </button>
        <button
          type="button"
          onClick={() => shiftWeek(7)}
          aria-label={t("cleaner.nextWeek")}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-input border border-border bg-surface text-ink"
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>

      {query.isPending ? <LoadingState label={t("common.loading")} /> : null}
      {query.isError ? (
        <ErrorState
          message={
            query.error instanceof Error
              ? query.error.message
              : t("common.errorGeneric")
          }
          onRetry={() => query.refetch()}
        />
      ) : null}
      {query.data && days.every((d) => d.jobs.length === 0) ? (
        <EmptyState title={t("cleaner.noJobs")} description={t("cleaner.noJobsBody")} />
      ) : null}

      {days.map((day) => (
        <section key={day.date} aria-label={formatDate(day.date)} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink">
            {formatDate(day.date)}{" "}
            <span className="font-normal text-muted">
              · {day.jobs.length}
            </span>
          </h2>
          {day.jobs.length === 0 ? (
            <p className="text-sm text-muted">{t("cleaner.emptyDay")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {day.jobs.map((job) => (
                <li key={job.jobId}>
                  <button
                    type="button"
                    onClick={() => setSelected(job)}
                    className="flex w-full items-center gap-3 rounded-card border border-border bg-surface p-3 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {job.customerName || job.reference}
                      </span>
                      <span className="block truncate text-xs tabular-nums text-muted">
                        {formatSlot(job.scheduledAt) || job.serviceName || job.reference}
                      </span>
                    </span>
                    <StatusBadge
                      status={KIND_BY_STATUS[job.status.toLowerCase()] ?? "pending"}
                      label={job.status.toLowerCase()}
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <JobDetailDrawer
        tenantSlug={tenantSlug}
        job={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
