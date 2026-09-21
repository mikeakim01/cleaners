"use client";

import {
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui";
import { usePlatformAudit } from "@/hooks/useAdmin";
import type { PlatformAuditRow } from "@/lib/admin-mappers";
import { formatDate } from "@/lib/format";
import { t } from "@/i18n";

export function AuditClient({
  initial,
  initialError,
}: {
  initial: PlatformAuditRow[] | null;
  initialError: string | null;
}) {
  const query = usePlatformAudit();
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
  if ((data ?? []).length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-bold tracking-tight">
          {t("admin.audit")}
        </h1>
        <EmptyState
          title={t("admin.emptyAudit")}
          description={initialError ?? undefined}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold tracking-tight">{t("admin.audit")}</h1>
      <DataTable<PlatformAuditRow>
        columns={[
          { key: "action", header: t("admin.colAction") },
          {
            key: "actor",
            header: t("admin.colActor"),
            render: (row) => row.actorUserId ?? "–",
          },
          {
            key: "tenant",
            header: t("admin.colTenant"),
            render: (row) => row.tenantId ?? "–",
          },
          {
            key: "createdAt",
            header: t("admin.colDate"),
            render: (row) => (
              <span className="tabular-nums">{formatDate(row.createdAt)}</span>
            ),
          },
        ]}
        rows={data ?? []}
        getRowKey={(row, i) =>
          `${row.action}-${row.createdAt}-${row.actorUserId ?? "x"}-${i}`
        }
      />
    </div>
  );
}
