"use client";

import { useState } from "react";
import Link from "next/link";
import { Ban, CheckCircle2, Search } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  StatusBadge,
} from "@/components/ui";
import type { StatusKind } from "@/components/ui/StatusBadge";
import { useAdminMutations, useAllTenants } from "@/hooks/useAdmin";
import type { AdminTenantRow } from "@/lib/admin-mappers";
import { formatDate } from "@/lib/format";
import { t } from "@/i18n";

const KIND_BY_STATUS: Record<string, StatusKind> = {
  active: "success",
  trialing: "warning",
  past_due: "danger",
  cancelled: "cancelled",
  suspended: "danger",
};

export function TenantsClient({
  initial,
  initialError,
}: {
  initial: AdminTenantRow[] | null;
  initialError: string | null;
}) {
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<AdminTenantRow | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const query = useAllTenants(search);
  const data = query.data ?? (search === "" ? initial : undefined);
  const mutations = useAdminMutations();

  const applySuspend = async () => {
    if (!confirm) return;
    setFeedback(null);
    try {
      await mutations.setSuspended.mutateAsync({
        tenantId: confirm.id,
        suspended: !confirm.suspended,
      });
      setFeedback(t("common.success"));
      setConfirm(null);
    } catch (e) {
      setFeedback((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold tracking-tight">{t("admin.tenants")}</h1>

      <Input
        aria-label={t("admin.searchTenants")}
        placeholder={t("admin.searchTenants")}
        icon={<Search size={18} aria-hidden="true" />}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {feedback ? (
        <p
          role="status"
          className="rounded-card bg-tint px-4 py-2 text-sm text-primary"
        >
          {feedback}
        </p>
      ) : null}

      {query.isPending && !data ? (
        <LoadingState label={t("common.loading")} />
      ) : query.isError && !data ? (
        <ErrorState
          message={initialError ?? (query.error as Error).message}
          onRetry={() => query.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : (data ?? []).length === 0 ? (
        <EmptyState
          title={t("admin.emptyTenants")}
          description={search ? undefined : (initialError ?? undefined)}
        />
      ) : (
        <DataTable<AdminTenantRow>
          columns={[
            {
              key: "name",
              header: t("admin.colTenant"),
              render: (row) => (
                <span>
                  <Link
                    href={`/admin/tenants/${row.id}`}
                    className="font-semibold text-primary underline-offset-2 hover:underline"
                  >
                    {row.name}
                  </Link>
                  <span className="block text-xs text-muted">/{row.slug}</span>
                </span>
              ),
            },
            { key: "planName", header: t("admin.colPlan") },
            {
              key: "status",
              header: t("admin.colStatus"),
              render: (row) => (
                <StatusBadge
                  status={
                    row.suspended
                      ? "danger"
                      : (KIND_BY_STATUS[row.subscriptionStatus] ?? "pending")
                  }
                  label={
                    row.suspended ? t("admin.suspended") : row.subscriptionStatus
                  }
                />
              ),
            },
            {
              key: "users",
              header: t("admin.colUsers"),
              align: "right",
              render: (row) => (
                <span className="tabular-nums">{row.users}</span>
              ),
            },
            {
              key: "bookings",
              header: t("admin.colBookings"),
              align: "right",
              render: (row) => (
                <span className="tabular-nums">{row.bookingsVolume}</span>
              ),
            },
            {
              key: "trial",
              header: t("admin.colTrialEnds"),
              render: (row) =>
                row.trialEndsAt ? (
                  <span className="tabular-nums">
                    {formatDate(row.trialEndsAt)}
                  </span>
                ) : (
                  "–"
                ),
            },
            {
              key: "actions",
              header: t("common.actions"),
              align: "right",
              render: (row) => (
                <Button
                  size="sm"
                  variant={row.suspended ? "secondary" : "danger"}
                  onClick={() => setConfirm(row)}
                >
                  {row.suspended ? (
                    <>
                      <CheckCircle2 size={18} aria-hidden="true" />
                      {t("admin.reactivate")}
                    </>
                  ) : (
                    <>
                      <Ban size={18} aria-hidden="true" />
                      {t("admin.suspend")}
                    </>
                  )}
                </Button>
              ),
            },
          ]}
          rows={data ?? []}
          getRowKey={(row) => row.id}
        />
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm?.suspended ? t("admin.reactivateTitle") : t("admin.suspendTitle")
        }
        message={
          confirm?.suspended
            ? t("admin.reactivateBody")
            : t("admin.suspendBody")
        }
        confirmLabel={
          confirm?.suspended ? t("admin.reactivate") : t("admin.suspend")
        }
        cancelLabel={t("common.cancel")}
        danger={!confirm?.suspended}
        loading={mutations.setSuspended.isPending}
        onConfirm={applySuspend}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
