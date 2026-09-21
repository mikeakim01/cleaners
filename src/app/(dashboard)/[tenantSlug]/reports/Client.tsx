"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Button,
  Currency,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui";
import { useFinancialSummary } from "@/hooks/useReports";
import { useInvoices } from "@/hooks/useInvoices";
import { usePayments } from "@/hooks/usePayments";
import { formatDate, formatMoney } from "@/lib/format";
import { t } from "@/i18n";
import type {
  FinancialSummary,
  ReportRange,
} from "@/lib/tracki-types";

type Preset = "today" | "week" | "month";

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rangeFor(preset: Preset): ReportRange {
  const now = new Date();
  if (preset === "today") {
    const day = isoDay(now);
    return { from: day, to: day };
  }
  const days = preset === "week" ? 7 : 30;
  const from = new Date(now.getTime() - (days - 1) * 86_400_000);
  return { from: isoDay(from), to: isoDay(now) };
}

function downloadCsv(filename: string, header: string[], lines: string[][]) {
  const escape = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const csv = [header, ...lines]
    .map((row) => row.map(escape).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ReportsClient({
  tenantId,
  initial,
}: {
  tenantId: string;
  initial: FinancialSummary | null;
}) {
  const [preset, setPreset] = useState<Preset>("month");
  const range = useMemo(() => rangeFor(preset), [preset]);
  const summary = useFinancialSummary(tenantId, range);
  const data = summary.data ?? initial;

  // Source rows for client-side CSV export (server-filtered lists).
  const invoices = useInvoices(tenantId, {
    from: range.from,
    to: range.to,
    page: 1,
    pageSize: 200,
  });
  const payments = usePayments(tenantId);

  const cards = useMemo(
    () => [
      { label: t("reports.revenue"), value: data?.revenueMinor ?? 0 },
      { label: t("reports.collected"), value: data?.collectedMinor ?? 0 },
      { label: t("reports.outstanding"), value: data?.outstandingMinor ?? 0 },
      { label: t("reports.overdue"), value: data?.overdueMinor ?? 0 },
    ],
    [data],
  );

  const exportInvoices = () => {
    const rows = invoices.data?.rows ?? [];
    downloadCsv(
      `invoices-${range.from}-${range.to}.csv`,
      ["reference", "customer", "date", "status", "total", "balance"],
      rows.map((r) => [
        r.reference,
        r.customerName ?? "",
        r.issueDate,
        r.status,
        formatMoney(r.totalMinor, r.currency ?? "TZS"),
        formatMoney(r.balanceMinor, r.currency ?? "TZS"),
      ]),
    );
  };

  const exportPayments = () => {
    const rows = payments.data?.rows ?? [];
    downloadCsv(
      `payments-${range.from}-${range.to}.csv`,
      ["date", "invoice", "customer", "provider", "reference", "amount", "status"],
      rows.map((r) => [
        r.createdAt,
        r.invoiceReference ?? r.invoiceId ?? "",
        r.customerName ?? "",
        r.provider,
        r.providerRef ?? "",
        formatMoney(r.amountMinor, r.currency ?? "TZS"),
        r.status,
      ]),
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">{t("reports.title")}</h1>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("reports.range")}>
          {(["today", "week", "month"] as const).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={preset === p ? "primary" : "secondary"}
              onClick={() => setPreset(p)}
            >
              {t(`reports.${p}` as Parameters<typeof t>[0])}
            </Button>
          ))}
        </div>
      </div>

      {summary.isPending && !data ? (
        <LoadingState label={t("common.loading")} />
      ) : summary.isError && !data ? (
        <ErrorState
          message={(summary.error as Error).message}
          onRetry={() => summary.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : !data || cards.every((c) => c.value === 0) ? (
        <EmptyState
          title={t("reports.emptyTitle")}
          description={t("reports.emptyBody")}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {cards.map((c) => (
              <div
                key={c.label}
                className="rounded-card border border-border bg-surface px-3 py-2.5"
              >
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
                  {c.label}
                </p>
                <Currency amountMinor={c.value} className="text-xl font-bold" />
              </div>
            ))}
          </div>

          <section
            className="rounded-card border border-border bg-surface p-4"
            aria-label={t("reports.collectionsOverTime")}
          >
            <h2 className="font-heading text-base font-semibold">
              {t("reports.collectionsOverTime")}
            </h2>
            <div className="mt-2 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={(data?.byDay ?? []).map((d) => ({
                    date: formatDate(d.date),
                    collected: d.collectedMinor / 100,
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="collected"
                    stroke="#0F766E"
                    fill="#0F766E"
                    fillOpacity={0.2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section
            className="rounded-card border border-border bg-surface p-4"
            aria-label={t("reports.byStatus")}
          >
            <h2 className="font-heading text-base font-semibold">{t("reports.byStatus")}</h2>
            <div className="mt-2 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={(data?.byStatus ?? []).map((s) => ({
                    status: s.status,
                    total: s.totalMinor / 100,
                    count: s.count,
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="status" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="total" fill="#0F766E" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section
            className="rounded-card border border-border bg-surface p-4"
            aria-label={t("reports.byBranch")}
          >
            <h2 className="font-heading text-base font-semibold">{t("reports.byBranch")}</h2>
            <div className="mt-2">
              <DataTable
                columns={[
                  { key: "branch", header: t("reports.colBranch"), render: (row) => row.branch },
                  {
                    key: "count",
                    header: t("reports.colCount"),
                    align: "right",
                    render: (row) => <span className="tabular-nums">{row.count}</span>,
                  },
                  {
                    key: "total",
                    header: t("reports.colTotal"),
                    align: "right",
                    render: (row) => <Currency amountMinor={row.totalMinor} />,
                  },
                ]}
                rows={data?.byBranch ?? []}
                getRowKey={(row) => row.branch}
                emptyTitle={t("reports.emptyTitle")}
                emptyBody={t("reports.emptyBody")}
              />
            </div>
          </section>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={exportInvoices}>
              <Download size={18} aria-hidden="true" />
              {t("reports.exportInvoices")}
            </Button>
            <Button size="sm" variant="secondary" onClick={exportPayments}>
              <Download size={18} aria-hidden="true" />
              {t("reports.exportPayments")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
