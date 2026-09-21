"use client";

import { useState } from "react";
import { AlertTriangle, Hourglass } from "lucide-react";
import {
  Button,
  Currency,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui";
import { useAdminMutations, usePlatformStats } from "@/hooks/useAdmin";
import type { PlatformStats } from "@/lib/admin-mappers";
import { t } from "@/i18n";

function Stat({
  label,
  value,
  money,
}: {
  label: string;
  value: number | undefined;
  money?: boolean;
}) {
  return (
    <div className="rounded-card border border-border bg-surface px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </p>
      {money && typeof value === "number" ? (
        <Currency amountMinor={value} className="text-xl font-bold" />
      ) : (
        <p className="text-xl font-bold tabular-nums text-ink">
          {typeof value === "number" ? value.toLocaleString("en-GB") : "–"}
        </p>
      )}
    </div>
  );
}

export function AdminOverviewClient({
  initial,
  initialError,
}: {
  initial: PlatformStats | null;
  initialError: string | null;
}) {
  const query = usePlatformStats();
  const data = query.data ?? initial;
  const [feedback, setFeedback] = useState<string | null>(null);
  const mutations = useAdminMutations();

  const runExpiries = async () => {
    setFeedback(null);
    try {
      const n = await mutations.processExpiries.mutateAsync();
      setFeedback(`${t("admin.processSuccess")} (${n})`);
    } catch (e) {
      setFeedback((e as Error).message);
    }
  };

  if (query.isPending && !data) {
    return <LoadingState label={t("common.loading")} />;
  }
  if (query.isError && !data) {
    return (
      <ErrorState
        message={initialError ?? (query.error as Error).message}
        onRetry={() => query.refetch()}
        retryLabel={t("common.retry")}
      />
    );
  }
  if (!data) {
    return (
      <EmptyState
        title={t("common.empty")}
        description={initialError ?? undefined}
      />
    );
  }

  const maxCount = Math.max(1, ...data.planDistribution.map((p) => p.count));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold tracking-tight">
          {t("admin.overview")}
        </h1>
        <span className="ml-auto">
          <Button
            size="sm"
            variant="secondary"
            onClick={runExpiries}
            loading={mutations.processExpiries.isPending}
          >
            {t("admin.processExpiries")}
          </Button>
        </span>
      </div>

      {feedback ? (
        <p
          role="status"
          className="rounded-card bg-tint px-4 py-2 text-sm text-primary"
        >
          {feedback}
        </p>
      ) : null}

      {data.trialsExpiring > 0 ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-card border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900"
        >
          <AlertTriangle size={18} aria-hidden="true" className="shrink-0" />
          <span>
            {t("admin.trialsExpiring")}:{" "}
            <strong className="tabular-nums">{data.trialsExpiring}</strong>
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label={t("admin.mrr")} value={data.mrrMinor} money />
        <Stat label={t("admin.tenants")} value={data.tenantsTotal} />
        <Stat label={t("admin.activeTenants")} value={data.tenantsActive} />
        <Stat label={t("admin.trialing")} value={data.trialing} />
        <Stat label={t("admin.pastDue")} value={data.pastDue} />
        <Stat label={t("admin.users")} value={data.usersTotal} />
        <Stat label={t("admin.bookings")} value={data.bookingsTotal} />
        <Stat label={t("admin.trialsExpiring")} value={data.trialsExpiring} />
      </div>

      <section
        aria-label={t("admin.planDistribution")}
        className="rounded-card border border-border bg-surface p-4"
      >
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
          <Hourglass size={18} aria-hidden="true" />
          {t("admin.planDistribution")}
        </h2>
        {data.planDistribution.length === 0 ? (
          <p className="text-sm text-muted">{t("common.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.planDistribution.map((p) => (
              <li key={p.planName} className="flex items-center gap-3 text-sm">
                <span className="w-32 shrink-0 truncate font-medium text-ink">
                  {p.planName}
                </span>
                <span
                  aria-hidden="true"
                  className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-canvas"
                >
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${(p.count / maxCount) * 100}%` }}
                  />
                </span>
                <span className="w-10 shrink-0 text-right tabular-nums text-muted">
                  {p.count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
