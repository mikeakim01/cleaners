"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Avatar,
  Button,
  ConfirmDialog,
  Currency,
  DataTable,
  DatePicker,
  Drawer,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Select,
  StatusBadge,
} from "@/components/ui";
import type { StatusKind } from "@/components/ui/StatusBadge";
import { AssignmentPicker } from "@/components/domain/AssignmentPicker";
import { useBookings } from "@/hooks/useBookings";
import { useBulkTransitionBooking } from "@/hooks/useBookingDetail";
import { useCatalog } from "@/hooks/useCatalog";
import { useEmployees } from "@/hooks/useEmployees";
import { useTeams } from "@/hooks/useTeams";
import { useJobs } from "@/hooks/useJobs";
import { formatDate, formatPhone255 } from "@/lib/format";
import { t } from "@/i18n";
import type { Booking, BookingFilters, BookingListData } from "@/lib/trackf-types";

const KIND_BY_STATUS: Record<string, StatusKind> = {
  pending: "pending",
  quote_sent: "warning",
  quote_approved: "info",
  confirmed: "confirmed",
  scheduled: "info",
  assigned: "confirmed",
  en_route: "in_progress",
  arrived: "in_progress",
  in_progress: "in_progress",
  on_hold: "warning",
  quality_check: "info",
  completed: "completed",
  invoiced: "info",
  paid: "success",
  cancelled: "cancelled",
  rejected: "danger",
};

const STATUS_OPTIONS = [
  "pending",
  "confirmed",
  "quote_sent",
  "quote_approved",
  "scheduled",
  "assigned",
  "en_route",
  "in_progress",
  "completed",
  "paid",
  "cancelled",
];

const EMPTY_FILTERS: BookingFilters = { page: 1, pageSize: 20 };

function Kpi({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-card border border-border bg-surface px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="text-xl font-bold tabular-nums text-ink">
        {typeof value === "number" ? value.toLocaleString("en-GB") : t("ops.kpiEmpty")}
      </p>
    </div>
  );
}

export function BookingsClient({
  tenantId,
  initial,
}: {
  tenantId: string;
  initial: BookingListData | null;
}) {
  const [filters, setFilters] = useState<BookingFilters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<string[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [teamId, setTeamId] = useState("");
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);

  const query = useBookings(tenantId, filters);
  const data = query.data ?? initial;
  const catalog = useCatalog(tenantId);
  const employees = useEmployees(tenantId);
  const { teams } = useTeams(tenantId);
  const jobs = useJobs(tenantId);
  const bulkTransition = useBulkTransitionBooking(tenantId);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const branches = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.branchId) map.set(r.branchId, r.branchName ?? r.branchId);
    }
    return [...map.entries()];
  }, [rows]);

  const selectedRows = rows.filter((r) => selected.includes(r.reference));
  const selectedTotal = selectedRows.reduce((sum, r) => sum + (r.totalMinor ?? 0), 0);

  const patch = (p: Partial<BookingFilters>) => {
    setFilters((f) => ({ ...f, ...p, page: p.page ?? 1 }));
    setSelected([]);
  };
  const reset = () => {
    setFilters(EMPTY_FILTERS);
    setSelected([]);
  };

  const toggle = (ref: string) =>
    setSelected((s) => (s.includes(ref) ? s.filter((x) => x !== ref) : [...s, ref]));

  const confirmAssign = async () => {
    setFeedback(null);
    try {
      const withJobs = selectedRows.filter((r) => r.jobId);
      for (const row of withJobs) {
        if (teamId) {
          await jobs.assignTeamToJob.mutateAsync({ jobId: row.jobId as string, teamId });
        }
        if (employeeIds.length > 0) {
          await jobs.assignEmployeesToJob.mutateAsync({
            jobId: row.jobId as string,
            employeeIds,
          });
        }
      }
      setFeedback(t("jobs.assignSuccess"));
      setAssignOpen(false);
    } catch (e) {
      setFeedback((e as Error).message);
    }
  };

  const confirmCancel = async () => {
    setFeedback(null);
    try {
      for (const ref of selected) {
        await bulkTransition.mutateAsync({ reference: ref, to: "cancelled" });
      }
      setFeedback(t("bookings.cancelSuccess"));
      setSelected([]);
      setCancelOpen(false);
    } catch (e) {
      setFeedback((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold tracking-tight">{t("bookings.title")}</h1>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label={t("ops.today")} value={data?.kpis?.todayDispatch} />
        <Kpi label={t("ops.unassigned")} value={data?.kpis?.unassigned} />
        <Kpi label={t("ops.enRoute")} value={data?.kpis?.enRoute} />
        <Kpi label={t("ops.awaitingQuote")} value={data?.kpis?.awaitingQuote} />
        <Kpi label={t("ops.collections")} value={data?.kpis?.collectionsPending} />
        <Kpi label={t("ops.sla")} value={data?.kpis?.slaAtRisk} />
      </div>

      {/* Filter bar */}
      <div className="grid grid-cols-1 gap-2 rounded-card border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-3">
        <Input
          aria-label={t("ops.searchRef")}
          placeholder={t("ops.searchRef")}
          value={filters.search ?? ""}
          onChange={(e) => patch({ search: e.target.value })}
        />
        <Select
          aria-label={t("ops.statusAll")}
          value={filters.status ?? ""}
          onChange={(e) => patch({ status: e.target.value || undefined })}
          options={STATUS_OPTIONS.map((s) => ({ value: s, label: s }))}
          placeholder={t("ops.statusAll")}
        />
        <Select
          aria-label={t("ops.serviceAll")}
          value={filters.serviceId ?? ""}
          onChange={(e) => patch({ serviceId: e.target.value || undefined })}
          options={(catalog.list.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          placeholder={t("ops.serviceAll")}
        />
        <DatePicker
          aria-label={t("ops.from")}
          value={filters.from ?? ""}
          onChange={(e) => patch({ from: e.target.value || undefined })}
        />
        <DatePicker
          aria-label={t("ops.to")}
          value={filters.to ?? ""}
          onChange={(e) => patch({ to: e.target.value || undefined })}
        />
        <Select
          aria-label={t("ops.branchAll")}
          value={filters.branchId ?? ""}
          onChange={(e) => patch({ branchId: e.target.value || undefined })}
          options={branches.map(([id, name]) => ({ value: id, label: name }))}
          placeholder={t("ops.branchAll")}
        />
        <div className="sm:col-span-2 lg:col-span-3">
          <Button variant="secondary" size="sm" onClick={reset}>
            {t("ops.reset")}
          </Button>
        </div>
      </div>

      {feedback ? (
        <p role="status" className="rounded-card bg-tint px-4 py-2 text-sm text-primary">
          {feedback}
        </p>
      ) : null}

      {/* Bulk bar */}
      {selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-card border border-primary/20 bg-tint px-4 py-2.5">
          <span className="text-sm font-semibold text-ink">
            {selected.length} {t("ops.selected")}
          </span>
          <Currency amountMinor={selectedTotal} />
          <span className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setAssignOpen(true)}>
              {t("ops.assign")}
            </Button>
            <span title={t("ops.whatsappPhase4")}>
              <Button size="sm" variant="secondary" disabled>
                {t("ops.whatsapp")}
              </Button>
            </span>
            <span title={t("ops.invoicePhase3")}>
              <Button size="sm" variant="secondary" disabled>
                {t("ops.invoice")}
              </Button>
            </span>
            <Button size="sm" variant="danger" onClick={() => setCancelOpen(true)}>
              {t("ops.cancelSelected")}
            </Button>
          </span>
        </div>
      ) : null}

      {query.isPending && !data ? (
        <LoadingState label={t("common.loading")} />
      ) : query.isError && !data ? (
        <ErrorState
          message={(query.error as Error).message}
          onRetry={() => query.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : rows.length === 0 ? (
        <EmptyState title={t("ops.noResultsTitle")} description={t("ops.noResultsBody")} />
      ) : (
        <>
          <DataTable<Booking>
            columns={[
              {
                key: "select",
                header: "",
                render: (row) => (
                  <input
                    type="checkbox"
                    aria-label={`${t("ops.colRef")} ${row.reference}`}
                    checked={selected.includes(row.reference)}
                    onChange={() => toggle(row.reference)}
                    className="size-4 accent-[#0F766E]"
                  />
                ),
              },
              {
                key: "reference",
                header: t("ops.colRef"),
                render: (row) => (
                  <Link
                    href={`/${tenantId}/bookings/${row.reference}`}
                    className="font-semibold text-primary underline-offset-2 hover:underline"
                  >
                    {row.reference}
                  </Link>
                ),
              },
              {
                key: "customer",
                header: t("ops.colCustomer"),
                render: (row) => (
                  <span>
                    <span className="block font-medium">{row.customerName}</span>
                    {row.customerPhone ? (
                      <span className="block text-xs text-muted">
                        {formatPhone255(row.customerPhone)}
                      </span>
                    ) : null}
                  </span>
                ),
              },
              { key: "service", header: t("ops.colService"), render: (row) => row.serviceName },
              {
                key: "slot",
                header: t("ops.colSlot"),
                render: (row) => (
                  <span className="tabular-nums">
                    {formatDate(row.date)}
                    {row.timeSlot ? ` · ${row.timeSlot}` : ""}
                  </span>
                ),
              },
              {
                key: "location",
                header: t("ops.colLocation"),
                render: (row) => row.ward ?? row.address ?? "",
              },
              {
                key: "crew",
                header: t("ops.colCrew"),
                render: (row) => (
                  <span className="flex -space-x-2">
                    {(row.crew ?? []).map((c) => (
                      <Avatar key={c.name} name={c.name} src={c.avatarUrl} size="sm" />
                    ))}
                  </span>
                ),
              },
              {
                key: "amount",
                header: t("ops.amount"),
                align: "right",
                render: (row) => (
                  <Currency
                    amountMinor={row.totalMinor}
                    currency={row.currency ?? "TZS"}
                  />
                ),
              },
              {
                key: "status",
                header: t("ops.colStatus"),
                render: (row) => (
                  <StatusBadge status={KIND_BY_STATUS[row.status] ?? "pending"} label={row.status} />
                ),
              },
            ]}
            rows={rows}
            getRowKey={(row) => row.id}
          />
          <div className="flex items-center justify-between text-sm text-muted">
            <span>
              {t("common.page")} {data?.page ?? 1} {t("common.of")}{" "}
              {Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 20)))}
              {" · "}
              {data?.total ?? 0} {t("common.total").toLowerCase()}
            </span>
            <span className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={(data?.page ?? 1) <= 1}
                onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
              >
                {t("common.prev")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
              >
                {t("common.next")}
              </Button>
            </span>
          </div>
        </>
      )}

      <Drawer open={assignOpen} onClose={() => setAssignOpen(false)} title={t("ops.assign")}>
        <AssignmentPicker
          employees={employees.list.data ?? []}
          teams={teams}
          selectedTeamId={teamId}
          selectedEmployeeIds={employeeIds}
          onTeamChange={setTeamId}
          onEmployeesChange={setEmployeeIds}
          loading={employees.list.isPending}
        />
        {employees.list.isError ? (
          <ErrorState
            message={(employees.list.error as Error).message}
            onRetry={() => employees.list.refetch()}
            retryLabel={t("common.retry")}
          />
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setAssignOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={confirmAssign}
            loading={jobs.assignEmployeesToJob.isPending || jobs.assignTeamToJob.isPending}
          >
            {t("common.confirm")}
          </Button>
        </div>
      </Drawer>

      <ConfirmDialog
        open={cancelOpen}
        title={t("bookings.cancelTitle")}
        message={t("bookings.cancelBody")}
        confirmLabel={t("bookings.cancelConfirm")}
        cancelLabel={t("common.cancel")}
        danger
        loading={bulkTransition.isPending}
        onConfirm={confirmCancel}
        onCancel={() => setCancelOpen(false)}
      />
    </div>
  );
}
