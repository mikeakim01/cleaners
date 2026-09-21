"use client";

import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import {
  Currency,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
} from "@/components/ui";
import { useTenantDetail } from "@/hooks/useAdmin";
import type { TenantDetailData } from "@/lib/admin-mappers";
import { formatDate } from "@/lib/format";
import { t } from "@/i18n";

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-border bg-surface px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </p>
      <div className="mt-1 text-sm text-ink">{children}</div>
    </div>
  );
}

function UsageMeters({ usage }: { usage: TenantDetailData["usage"] }) {
  if (usage.length === 0) {
    return <p className="text-sm text-muted">{t("common.empty")}</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {usage.map((u) => {
        const pct =
          u.limit > 0 ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0;
        return (
          <li key={u.key} className="text-sm">
            <span className="flex items-baseline justify-between gap-2">
              <span className="font-medium text-ink">{u.key}</span>
              <span className="tabular-nums text-muted">
                {u.used.toLocaleString("en-GB")} /{" "}
                {u.limit > 0 ? u.limit.toLocaleString("en-GB") : "∞"}
              </span>
            </span>
            <span
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={u.key}
              className="mt-1 block h-2 overflow-hidden rounded-full bg-canvas"
            >
              <span
                aria-hidden="true"
                className="block h-full rounded-full bg-primary"
                style={{ width: `${pct}%` }}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function TenantDetailClient({
  tenantId,
  initial,
  initialError,
}: {
  tenantId: string;
  initial: TenantDetailData | null;
  initialError: string | null;
}) {
  const query = useTenantDetail(tenantId);
  const data = query.data ?? initial;

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

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/admin/tenants"
        className="inline-flex items-center gap-1 text-sm font-medium text-primary"
      >
        <ArrowLeft size={18} aria-hidden="true" />
        {t("admin.backToTenants")}
      </Link>
      <h1 className="text-xl font-bold tracking-tight">
        {data.tenant.name}{" "}
        <span className="text-sm font-normal text-muted">
          /{data.tenant.slug}
        </span>
      </h1>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Card label={t("admin.colStatus")}>
          <StatusBadge
            status={data.tenant.suspended ? "danger" : "success"}
            label={
              data.tenant.suspended
                ? t("admin.suspended")
                : data.subscription.status
            }
          />
        </Card>
        <Card label={t("admin.colPlan")}>
          <span className="font-semibold">{data.subscription.planName}</span>{" "}
          <Currency
            amountMinor={data.subscription.priceMinor}
            currency={data.subscription.currency}
          />
        </Card>
        <Card label={t("admin.colTrialEnds")}>
          <span className="tabular-nums">
            {data.subscription.trialEndsAt
              ? formatDate(data.subscription.trialEndsAt)
              : "–"}
          </span>
        </Card>
        <Card label={t("admin.counts")}>
          <span className="tabular-nums">
            {data.counts.users} {t("admin.users")} · {data.counts.bookings}{" "}
            {t("admin.bookings")} · {data.counts.invoices} {t("admin.invoices")}
          </span>
        </Card>
      </div>

      <section
        aria-label={t("admin.usage")}
        className="rounded-card border border-border bg-surface p-4"
      >
        <h2 className="mb-3 text-sm font-semibold text-ink">
          {t("admin.usage")}
        </h2>
        <UsageMeters usage={data.usage} />
      </section>

      <section aria-label={t("admin.members")}>
        <h2 className="mb-2 text-sm font-semibold text-ink">
          {t("admin.members")}
        </h2>
        <DataTable
          columns={[
            { key: "name", header: t("admin.colName") },
            { key: "email", header: t("admin.colEmail") },
            { key: "role", header: t("admin.colRole") },
          ]}
          rows={data.members}
          getRowKey={(row) => row.id}
          emptyTitle={t("admin.emptyMembers")}
        />
      </section>

      <p className="flex items-start gap-2 rounded-card border border-border bg-surface px-4 py-2.5 text-xs text-muted">
        <ShieldAlert size={18} aria-hidden="true" className="shrink-0" />
        {t("admin.viewLoggedNote")}
      </p>
    </div>
  );
}
