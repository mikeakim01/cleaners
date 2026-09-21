"use client";

import { Briefcase, CheckCircle2 } from "lucide-react";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { t } from "@/i18n";
import { useCleanerJobs } from "@/hooks/useCleanerJobs";
import { formatMoney } from "@/lib/format";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * HONEST earnings tab: there is no payout/payroll model. We show today's
 * completed-job count plus the summed booking job value, explicitly labeled
 * as job value — not a payout. See the hint string below.
 */
export function EarningsClient({ tenantSlug }: { tenantSlug: string }) {
  const query = useCleanerJobs(tenantSlug);

  if (query.isPending) return <LoadingState label={t("common.loading")} />;
  if (query.isError || !query.data) {
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

  const today = todayKey();
  const completedToday = query.data.jobs.filter(
    (j) =>
      j.status.toLowerCase() === "completed" &&
      (j.scheduledAt ? j.scheduledAt.slice(0, 10) === today : false),
  );
  const completedAll = query.data.jobs.filter(
    (j) => j.status.toLowerCase() === "completed",
  );
  const totalValueMinor = completedAll.reduce(
    (sum, j) => sum + (j.amountMinor ?? 0),
    0,
  );

  if (completedAll.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="font-heading text-xl font-bold text-ink">
          {t("cleaner.earningsTitle")}
        </h1>
        <EmptyState
          title={t("cleaner.noEarnings")}
          description={t("cleaner.noEarningsBody")}
          icon={<Briefcase size={18} aria-hidden="true" />}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h1 className="font-heading text-xl font-bold text-ink">
        {t("cleaner.earningsTitle")}
      </h1>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-card border border-border bg-surface p-4">
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <CheckCircle2 size={18} aria-hidden="true" />
            {t("cleaner.completedToday")}
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
            {completedToday.length}
          </p>
        </div>
        <div className="rounded-card border border-border bg-surface p-4">
          <p className="text-sm text-muted">{t("cleaner.totalJobValue")}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
            {formatMoney(totalValueMinor)}
          </p>
        </div>
      </div>
      <p className="text-sm text-muted">{t("cleaner.jobValueHint")}</p>
    </div>
  );
}
