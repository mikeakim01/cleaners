"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FilePlus2, FileText, Plus, Trash2 } from "lucide-react";
import {
  Button,
  Currency,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  Select,
  StatusBadge,
} from "@/components/ui";
import type { StatusKind } from "@/components/ui/StatusBadge";
import { DatePicker } from "@/components/ui/DatePicker";
import { useInvoices } from "@/hooks/useInvoices";
import { formatDate, formatMoney } from "@/lib/format";
import { t } from "@/i18n";
import type {
  CreateInvoiceLineInput,
  InvoiceFilters,
  InvoiceListData,
} from "@/lib/tracki-types";

const KIND_BY_STATUS: Record<string, StatusKind> = {
  draft: "pending",
  sent: "info",
  partial: "warning",
  paid: "success",
  void: "cancelled",
  overdue: "danger",
};

const STATUS_OPTIONS = ["draft", "sent", "partial", "paid", "void", "overdue"];

const EMPTY_FILTERS: InvoiceFilters = { page: 1, pageSize: 20 };

interface DraftLine extends CreateInvoiceLineInput {
  key: number;
}

/** Parse a major-unit money string into integer minor units (cents). */
function parseMajorToMinor(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export function InvoicesClient({
  tenantId,
  initial,
}: {
  tenantId: string;
  initial: InvoiceListData | null;
}) {
  const [filters, setFilters] = useState<InvoiceFilters>(EMPTY_FILTERS);
  const [modalOpen, setModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // New-invoice draft (inputs only; totals are confirmed by the server on save).
  const [bookingRef, setBookingRef] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [discountMajor, setDiscountMajor] = useState("");
  const [surchargeMajor, setSurchargeMajor] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([
    { key: 1, description: "", qty: 1, unit: "job", rateMinor: 0 },
  ]);

  const query = useInvoices(tenantId, filters);
  const data = query.data ?? initial;
  const rows = useMemo(() => data?.rows ?? [], [data]);

  const patch = (p: Partial<InvoiceFilters>) => {
    setFilters((f) => ({ ...f, ...p, page: p.page ?? 1 }));
  };

  // Display-only line sums for the unsaved draft (not invoice totals).
  const draftLinesMinor = lines.reduce(
    (sum, l) => sum + l.qty * l.rateMinor,
    0,
  );

  const patchLine = (key: number, p: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const addLine = () =>
    setLines((ls) => [
      ...ls,
      {
        key: Math.max(0, ...ls.map((l) => l.key)) + 1,
        description: "",
        qty: 1,
        unit: "job",
        rateMinor: 0,
      },
    ]);

  const removeLine = (key: number) =>
    setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));

  const submit = async () => {
    setFeedback(null);
    const items = lines
      .filter((l) => l.description.trim().length > 0)
      .map(({ description, qty, unit, rateMinor }) => ({
        description: description.trim(),
        qty: Math.max(1, Math.floor(qty)),
        unit: unit.trim() || "job",
        rateMinor: Math.max(0, Math.round(rateMinor)),
      }));
    if (items.length === 0) {
      setFeedback(t("invoices.itemRequired"));
      return;
    }
    try {
      await query.create.mutateAsync({
        bookingReference: bookingRef.trim() || undefined,
        customerName: customerName.trim() || undefined,
        dueDate: dueDate || undefined,
        items,
        discountMinor: parseMajorToMinor(discountMajor),
        surchargeMinor: parseMajorToMinor(surchargeMajor),
      });
      setFeedback(t("invoices.createSuccess"));
      setModalOpen(false);
    } catch (e) {
      setFeedback((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">{t("invoices.title")}</h1>
        <Button size="sm" onClick={() => setModalOpen(true)}>
          <FilePlus2 size={18} aria-hidden="true" />
          {t("invoices.newInvoice")}
        </Button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-card border border-border bg-surface px-3 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
            {t("invoices.collected")}
          </p>
          <Currency
            amountMinor={data?.kpis?.collectedMinor ?? 0}
            className="text-xl font-bold"
          />
        </div>
        <div className="rounded-card border border-border bg-surface px-3 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
            {t("invoices.outstanding")}
          </p>
          <Currency
            amountMinor={data?.kpis?.outstandingMinor ?? 0}
            className="text-xl font-bold"
          />
        </div>
        <div className="rounded-card border border-border bg-surface px-3 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
            {t("invoices.overdue")}
          </p>
          <Currency
            amountMinor={data?.kpis?.overdueMinor ?? 0}
            className="text-xl font-bold"
          />
        </div>
      </div>

      {/* Filter bar */}
      <div className="grid grid-cols-1 gap-2 rounded-card border border-border bg-surface p-3 sm:grid-cols-3">
        <Input
          aria-label={t("invoices.search")}
          placeholder={t("invoices.search")}
          value={filters.search ?? ""}
          onChange={(e) => patch({ search: e.target.value })}
        />
        <Select
          aria-label={t("invoices.status")}
          value={filters.status ?? ""}
          onChange={(e) => patch({ status: e.target.value || undefined })}
          options={STATUS_OPTIONS.map((s) => ({
            value: s,
            label: t(`invoiceStatus.${s}` as Parameters<typeof t>[0]),
          }))}
          placeholder={t("invoices.statusAll")}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setFilters(EMPTY_FILTERS)}
        >
          {t("ops.reset")}
        </Button>
      </div>

      {feedback ? (
        <p role="status" className="rounded-card bg-tint px-4 py-2 text-sm text-primary">
          {feedback}
        </p>
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
        <EmptyState
          title={t("invoices.emptyTitle")}
          description={t("invoices.emptyBody")}
          icon={<FileText size={18} aria-hidden="true" />}
          action={
            <Button size="sm" onClick={() => setModalOpen(true)}>
              {t("invoices.newInvoice")}
            </Button>
          }
        />
      ) : (
        <DataTable
          columns={[
            {
              key: "reference",
              header: t("invoices.colRef"),
              render: (row) => (
                <Link
                  href={`/${tenantId}/invoices/${row.reference}`}
                  className="font-semibold text-primary underline-offset-2 hover:underline"
                >
                  {row.reference}
                </Link>
              ),
            },
            {
              key: "customer",
              header: t("invoices.colCustomer"),
              render: (row) => row.customerName ?? "—",
            },
            {
              key: "date",
              header: t("invoices.colDate"),
              render: (row) => (
                <span className="tabular-nums">{formatDate(row.issueDate)}</span>
              ),
            },
            {
              key: "branch",
              header: t("invoices.colBranch"),
              render: (row) => row.branchName ?? "—",
            },
            {
              key: "status",
              header: t("invoices.colStatus"),
              render: (row) => (
                <StatusBadge
                  status={KIND_BY_STATUS[row.status] ?? "pending"}
                  label={row.status}
                />
              ),
            },
            {
              key: "total",
              header: t("invoices.colTotal"),
              align: "right",
              render: (row) => (
                <Currency
                  amountMinor={row.totalMinor}
                  currency={row.currency ?? "TZS"}
                />
              ),
            },
            {
              key: "balance",
              header: t("invoices.colBalance"),
              align: "right",
              render: (row) => (
                <Currency
                  amountMinor={row.balanceMinor}
                  currency={row.currency ?? "TZS"}
                />
              ),
            },
          ]}
          rows={rows}
          getRowKey={(row) => row.id}
        />
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t("invoices.newInvoice")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={submit} loading={query.create.isPending}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            label={t("invoices.bookingRef")}
            value={bookingRef}
            onChange={(e) => setBookingRef(e.target.value)}
            placeholder="BK-…"
          />
          <Input
            label={t("invoices.customer")}
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />
          <DatePicker
            label={t("invoices.dueDate")}
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{t("invoices.lineItems")}</p>
            {lines.map((l) => (
              <div key={l.key} className="grid grid-cols-12 items-end gap-2">
                <div className="col-span-5">
                  <Input
                    aria-label={t("invoices.description")}
                    placeholder={t("invoices.description")}
                    value={l.description}
                    onChange={(e) =>
                      patchLine(l.key, { description: e.target.value })
                    }
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    aria-label={t("invoices.qty")}
                    type="number"
                    min={1}
                    value={String(l.qty)}
                    onChange={(e) =>
                      patchLine(l.key, { qty: Number(e.target.value) })
                    }
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    aria-label={t("invoices.unit")}
                    value={l.unit}
                    onChange={(e) => patchLine(l.key, { unit: e.target.value })}
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    aria-label={t("invoices.rate")}
                    type="number"
                    min={0}
                    value={String(l.rateMinor / 100)}
                    onChange={(e) =>
                      patchLine(l.key, {
                        rateMinor: parseMajorToMinor(e.target.value),
                      })
                    }
                  />
                </div>
                <div className="col-span-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("invoices.removeLine")}
                    onClick={() => removeLine(l.key)}
                  >
                    <Trash2 size={18} aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
            <Button variant="secondary" size="sm" onClick={addLine}>
              <Plus size={18} aria-hidden="true" />
              {t("invoices.addLine")}
            </Button>
            <p className="text-xs text-muted tabular-nums">
              {t("invoices.linesSubtotal")}: {formatMoney(draftLinesMinor)}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              label={t("invoices.discount")}
              type="number"
              min={0}
              value={discountMajor}
              onChange={(e) => setDiscountMajor(e.target.value)}
            />
            <Input
              label={t("invoices.surcharge")}
              type="number"
              min={0}
              value={surchargeMajor}
              onChange={(e) => setSurchargeMajor(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted">{t("invoices.totalsHint")}</p>
        </div>
      </Modal>
    </div>
  );
}
