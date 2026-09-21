"use client";

import { useMemo, useState } from "react";
import { Button, EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { t } from "@/i18n";
import { useCleanerJobs } from "@/hooks/useCleanerJobs";
import type { CleanerJob } from "@/lib/cleaner-types";
import { readCachedJobs } from "@/lib/cleaner-outbox";
import { CleanerJobCard } from "@/components/cleaner/CleanerJobCard";
import { JobDetailDrawer } from "@/components/cleaner/JobDetailDrawer";

function sortJobs(jobs: CleanerJob[]): CleanerJob[] {
  return [...jobs].sort((a, b) => {
    if (!a.scheduledAt && !b.scheduledAt) return 0;
    if (!a.scheduledAt) return 1;
    if (!b.scheduledAt) return -1;
    return a.scheduledAt.localeCompare(b.scheduledAt);
  });
}

export function JobsClient({ tenantSlug }: { tenantSlug: string }) {
  const query = useCleanerJobs(tenantSlug);
  const [selected, setSelected] = useState<CleanerJob | null>(null);

  const data = useMemo(() => {
    if (query.data) return query.data;
    // First paint while offline: read the cache synchronously.
    const cached = readCachedJobs(tenantSlug);
    if (cached) {
      return { jobs: cached.jobs, fromCache: true, cachedAt: cached.cachedAt };
    }
    return null;
  }, [query.data, tenantSlug]);

  if (query.isPending && !data) return <LoadingState label={t("common.loading")} />;
  if (query.isError && !data) {
    return (
      <ErrorState
        message={
          query.error instanceof Error
            ? query.error.message
            : t("common.errorGeneric")
        }
        onRetry={() => query.refetch()}
      />
    );
  }

  const jobs = sortJobs(data?.jobs ?? []);
  const liveJob = selected
    ? (jobs.find((j) => j.jobId === selected.jobId) ?? selected)
    : null;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="font-heading text-xl font-bold text-ink">
          {t("cleaner.jobsTitle")}
        </h1>
        {data?.fromCache ? (
          <p role="status" className="text-sm text-warning">
            {t("cleaner.offline")} · {t("cleaner.cachedData")}
          </p>
        ) : null}
      </div>
      {jobs.length === 0 ? (
        <EmptyState
          title={t("cleaner.noJobs")}
          description={t("cleaner.noJobsBody")}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => query.refetch()}
            >
              {t("cleaner.retry")}
            </Button>
          }
        />
      ) : (
        jobs.map((job) => (
          <CleanerJobCard
            key={job.jobId}
            tenantSlug={tenantSlug}
            job={job}
            onSelect={setSelected}
          />
        ))
      )}
      <JobDetailDrawer
        tenantSlug={tenantSlug}
        job={liveJob}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
