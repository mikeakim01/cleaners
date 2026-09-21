"use client";

import { useMemo, useState } from "react";
import {
  Download,
  Mail,
  MessageCircle,
  Plus,
  Trash2,
} from "lucide-react";
import {
  Button,
  ConfirmDialog,
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
import {
  InvoicePreview,
  type InvoicePreviewData,
} from "@/components/domain/InvoicePreview";
import { useInvoiceDetail, useInvoices } from "@/hooks/useInvoices";
import { usePayments } from "@/hooks/usePayments";
import { formatDate, formatMoney } from "@/lib/format";
import { t } from "@/i18n";
import type {
  InvoiceDetail,
  InvoiceDetailData,
  InvoiceLineItem,
} from "@/lib/tracki-types";

const KIND_BY_STATUS: Record<string, StatusKind> = {
  draft: "pending",
  sent: "info",
  partial: "warning",
  paid: "success",
  void: "cancelled",
  overdue: "danger",
};

const FLOW = ["draft", "sent", "partial", "paid"] as const;

const PROVIDERS = [
  "cash",
  "bank_transfer",
  "mobile_money",
  "payment_link",
  "stripe",
];

const MPESA_REF_RE = /^[A-Z0-9]{8,12}$/;

function toPreview(invoice: InvoiceDetail): InvoicePreviewData {
  return {
    reference: invoice.reference,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    status: invoice.status,
    customerName: invoice.customerName,
    currency: invoice.currency,
    items: invoice.items,
    subtotalMinor: invoice.subtotalMinor,
    discountMinor: invoice.discountMinor,
    vatMinor: invoice.vatMinor,
    surchargeMinor: invoice.surchargeMinor,
    totalMinor: invoice.totalMinor,
    paidMinor: invoice.paidMinor,
    balanceMinor: invoice.balanceMinor,
    notes: invoice.notes,
  };
}

export function InvoiceDetailClient({
  tenantId,
  reference,
  initial,
}: {
  tenantId: string;
  reference: string;
  initial: InvoiceDetailData | null;
}) {
  const detail = useInvoiceDetail(tenantId, reference);
  const invoices = useInvoices(tenantId, {});
  const payments = usePayments(tenantId);

  const [feedback, setFeedback] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);

  // Builder state: local draft of the unsaved document.
  const [bookingRef, setBookingRef] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [notes, setNotes] = useState("");
  const [vatChecked, setVatChecked] = useState(true);
  const [discountMajor, setDiscountMajor] = useState("0");
  const [surchargeMajor, setSurchargeMajor] = useState("0");
  const [lines, setLines] = useState<InvoiceLineItem[]>([
    { description: "", qty: 1, unit: "job", rateMinor: 0, amountMinor: 0 },
  ]);

  // Payment form state.
  const [payAmountMajor, setPayAmountMajor] = useState("");
  const [provider, setProvider] = useState("cash");
  const [providerRef, setProviderRef] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [payError, setPayError] = useState<string | null>(null);
  const [stripeConfigured] = useState(false);

  const saved: InvoiceDetail | null = useMemo(() => {
    if (detail.data) return detail.data.invoice;
    return initial?.invoice ?? null;
  }, [detail.data, initial]);

  const savedPayments = useMemo(
    () => detail.data?.payments ?? initial?.payments ?? [],
    [detail.data, initial],
  );

  // Display-only line sums for the unsaved draft.
  const draftLinesMinor = lines.reduce(
    (sum, l) => sum + l.qty * l.rateMinor,
    0,
  );

  const previewInvoice: InvoicePreviewData | null = useMemo(() => {
    if (saved && lines.every((l) => l.description.trim().length === 0)) {
      return toPreview(saved);
    }
    if (!saved && draftLinesMinor === 0) return null;
    const base =
      saved ??
      ({
        id: "",
        reference,
        issueDate: issueDate || new Date().toISOString(),
        status: "draft",
        currency: "TZS",
        totalMinor: 0,
        paidMinor: 0,
        balanceMinor: 0,
        subtotalMinor: 0,
        discountMinor: 0,
        vatMinor: 0,
        surchargeMinor: 0,
        items: [],
        payments: [],
      } as InvoiceDetail);
    return {
      ...toPreview(base),
      customerName: customerName || base.customerName,
      dueDate: dueDate || base.dueDate,
      items: lines
        .filter((l) => l.description.trim().length > 0)
        .map((l) => ({ ...l, amountMinor: l.qty * l.rateMinor })),
    };
  }, [saved, lines, draftLinesMinor, reference, issueDate, dueDate, customerName]);

  const patchLine = (index: number, p: Partial<InvoiceLineItem>) =>
    setLines((ls) => ls.map((l, i) => (i === index ? { ...l, ...p } : l)));

  const saveDraft = async () => {
    setFeedback(null);
    const items = lines
      .filter((l) => l.description.trim().length > 0)
      .map((l) => ({
        description: l.description.trim(),
        qty: Math.max(1, Math.floor(l.qty)),
        unit: l.unit.trim() || "job",
        rateMinor: Math.max(0, Math.round(l.rateMinor)),
      }));
    if (items.length === 0) {
      setFeedback(t("invoices.itemRequired"));
      return;
    }
    try {
      const toMinor = (raw: string) => Math.max(0, Math.round(Number(raw) * 100) || 0);
      await invoices.create.mutateAsync({
        bookingReference: bookingRef.trim() || undefined,
        customerName: customerName.trim() || undefined,
        issueDate: issueDate || undefined,
        dueDate: dueDate || undefined,
        items,
        discountMinor: toMinor(discountMajor),
        surchargeMinor: toMinor(surchargeMajor),
        vatExempt: !vatChecked,
        notes: notes.trim() || undefined,
      });
      setFeedback(t("invoices.createSuccess"));
      await detail.refetch();
    } catch (e) {
      setFeedback((e as Error).message);
    }
  };

  const sendInvoice = async () => {
    if (!saved) return;
    setFeedback(null);
    try {
      await invoices.send.mutateAsync(saved.id);
      setFeedback(t("invoices.sendSuccess"));
      await detail.refetch();
    } catch (e) {
      setFeedback((e as Error).message);
    }
  };

  const confirmVoid = async () => {
    if (!saved) return;
    setFeedback(null);
    try {
      await invoices.voidInvoice.mutateAsync(saved.id);
      setFeedback(t("invoices.voidSuccess"));
      setVoidOpen(false);
      await detail.refetch();
    } catch (e) {
      setFeedback((e as Error).message);
    }
  };

  const submitPayment = async () => {
    if (!saved) return;
    setPayError(null);
    const amountMinor = Math.round(Number(payAmountMajor) * 100);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      setPayError(t("payments.amountInvalid"));
      return;
    }
    if (provider === "mobile_money" && !MPESA_REF_RE.test(providerRef.trim())) {
      setPayError(t("payments.mpesaRefInvalid"));
      return;
    }
    try {
      await payments.record.mutateAsync({
        invoiceId: saved.id,
        amountMinor,
        provider,
        providerRef: providerRef.trim() || undefined,
        notes: payNotes.trim() || undefined,
      });
      setPayOpen(false);
      setFeedback(t("payments.recordSuccess"));
      await detail.refetch();
    } catch (e) {
      setPayError((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <style>{`@media print { body * { visibility: hidden; } .invoice-print, .invoice-print * { visibility: visible; } .invoice-print { position: absolute; inset: 0; border: 0; } }`}</style>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight tabular-nums">{reference}</h1>
        {saved ? (
          <StatusBadge status={KIND_BY_STATUS[saved.status] ?? "pending"} label={saved.status} />
        ) : null}
      </div>

      {/* Status flow */}
      <ol className="flex flex-wrap items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" aria-label={t("invoices.statusFlow")}>
        {FLOW.map((s, i) => {
          const reached = saved
            ? FLOW.indexOf(s) <= Math.max(0, FLOW.indexOf(saved.status as (typeof FLOW)[number]))
            : s === "draft";
          return (
            <li key={s} className="flex items-center gap-1.5">
              {i > 0 ? <span aria-hidden="true" className="text-faint">→</span> : null}
              <span className={reached ? "text-primary" : "text-faint"}>{t(`invoiceStatus.${s}` as Parameters<typeof t>[0])}</span>
            </li>
          );
        })}
      </ol>

      {feedback ? (
        <p role="status" className="rounded-card bg-tint px-4 py-2 text-sm text-primary">
          {feedback}
        </p>
      ) : null}

      {detail.isPending && !initial ? (
        <LoadingState label={t("common.loading")} />
      ) : detail.isError && !initial ? (
        <ErrorState
          message={(detail.error as Error).message}
          onRetry={() => detail.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Left: builder */}
          <div className="flex flex-col gap-4">
            <section className="rounded-card border border-border bg-surface p-4" aria-label={t("invoices.documentConfig")}>
              <h2 className="font-heading text-base font-semibold">{t("invoices.documentConfig")}</h2>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Input label={t("invoices.colRef")} value={reference} readOnly />
                <Input
                  label={t("invoices.bookingRef")}
                  value={bookingRef}
                  onChange={(e) => setBookingRef(e.target.value)}
                  placeholder="BK-…"
                />
                <DatePicker
                  label={t("invoices.issueDate")}
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                />
                <DatePicker
                  label={t("invoices.dueDate")}
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div className="mt-2 rounded-card border border-border bg-canvas p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t("invoices.billTo")}</p>
                <Input
                  label={t("invoices.customer")}
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder={saved?.customerName ?? ""}
                />
              </div>
            </section>

            <section className="rounded-card border border-border bg-surface p-4" aria-label={t("invoices.lineItems")}>
              <h2 className="font-heading text-base font-semibold">{t("invoices.lineItems")}</h2>
              <div className="mt-3 flex flex-col gap-2">
                {lines.map((l, i) => (
                  <div key={i} className="grid grid-cols-12 items-end gap-2">
                    <div className="col-span-5">
                      <Input
                        aria-label={t("invoices.description")}
                        placeholder={t("invoices.description")}
                        value={l.description}
                        onChange={(e) => patchLine(i, { description: e.target.value })}
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        aria-label={t("invoices.qty")}
                        type="number"
                        min={1}
                        value={String(l.qty)}
                        onChange={(e) => patchLine(i, { qty: Number(e.target.value) })}
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        aria-label={t("invoices.unit")}
                        value={l.unit}
                        onChange={(e) => patchLine(i, { unit: e.target.value })}
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        aria-label={t("invoices.rate")}
                        type="number"
                        min={0}
                        value={String(l.rateMinor / 100)}
                        onChange={(e) =>
                          patchLine(i, {
                            rateMinor: Math.max(0, Math.round(Number(e.target.value) * 100) || 0),
                          })
                        }
                      />
                    </div>
                    <div className="col-span-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t("invoices.removeLine")}
                        onClick={() =>
                          setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))
                        }
                      >
                        <Trash2 size={18} aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                ))}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setLines((ls) => [
                      ...ls,
                      { description: "", qty: 1, unit: "job", rateMinor: 0, amountMinor: 0 },
                    ])
                  }
                >
                  <Plus size={18} aria-hidden="true" />
                  {t("invoices.addLine")}
                </Button>
              </div>
            </section>

            <section className="rounded-card border border-border bg-surface p-4" aria-label={t("invoices.calculations")}>
              <h2 className="font-heading text-base font-semibold">{t("invoices.calculations")}</h2>
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">{t("invoices.subtotal")}</dt>
                  <dd className="tabular-nums">{formatMoney(draftLinesMinor)}</dd>
                </div>
              </dl>
              <div className="mt-2 grid grid-cols-2 gap-2">
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
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={vatChecked}
                  onChange={(e) => setVatChecked(e.target.checked)}
                  className="size-4 accent-[#0F766E]"
                />
                {t("invoices.applyVat")}
              </label>
              <div className="mt-3 flex justify-between gap-4 border-t border-border pt-2">
                <span className="font-bold">{t("invoices.grandTotal")}</span>
                {saved ? (
                  <Currency amountMinor={saved.totalMinor} currency={saved.currency ?? "TZS"} />
                ) : (
                  <span className="tabular-nums text-muted">—</span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted">{t("invoices.totalsHint")}</p>
              <Input
                label={t("invoices.terms")}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </section>
          </div>

          {/* Right: live preview + actions */}
          <div className="flex flex-col gap-4">
            {previewInvoice ? (
              <InvoicePreview
                business={{ name: tenantId }}
                invoice={previewInvoice}
              />
            ) : (
              <EmptyState
                title={t("invoices.previewEmptyTitle")}
                description={t("invoices.previewEmptyBody")}
              />
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={saveDraft} loading={invoices.create.isPending}>
                {t("invoices.saveDraft")}
              </Button>
              <span title={t("invoices.whatsappPhase4")}>
                <Button size="sm" variant="secondary" disabled>
                  <MessageCircle size={18} aria-hidden="true" />
                  {t("invoices.sendWhatsapp")}
                </Button>
              </span>
              {saved ? (
                <a
                  href={`mailto:?subject=Invoice ${saved.reference}&body=${encodeURIComponent(`${t("invoices.emailBody")} ${saved.reference}`)}`}
                >
                  <Button size="sm" variant="secondary">
                    <Mail size={18} aria-hidden="true" />
                    {t("invoices.sendEmail")}
                  </Button>
                </a>
              ) : (
                <span title={t("invoices.saveFirst")}>
                  <Button size="sm" variant="secondary" disabled>
                    <Mail size={18} aria-hidden="true" />
                    {t("invoices.sendEmail")}
                  </Button>
                </span>
              )}
              <Button size="sm" variant="secondary" onClick={() => window.print()}>
                <Download size={18} aria-hidden="true" />
                {t("invoices.downloadPdf")}
              </Button>
              <Button size="sm" variant="secondary" onClick={sendInvoice} loading={invoices.send.isPending} disabled={!saved}>
                {t("invoices.send")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  if (saved) {
                    setPayAmountMajor(String(saved.balanceMinor / 100));
                    setPayOpen(true);
                  }
                }}
                disabled={!saved}
              >
                {t("payments.recordPayment")}
              </Button>
              <Button size="sm" variant="danger" onClick={() => setVoidOpen(true)} disabled={!saved}>
                {t("invoices.void")}
              </Button>
            </div>

            <section className="rounded-card border border-border bg-surface p-4" aria-label={t("payments.title")}>
              <h2 className="font-heading text-base font-semibold">{t("payments.title")}</h2>
              {savedPayments.length === 0 ? (
                <p className="mt-2 text-sm text-muted">{t("payments.emptyBody")}</p>
              ) : (
                <div className="mt-2">
                  <DataTable
                    columns={[
                      {
                        key: "date",
                        header: t("payments.colDate"),
                        render: (row) => (
                          <span className="tabular-nums">{formatDate(row.createdAt)}</span>
                        ),
                      },
                      {
                        key: "provider",
                        header: t("payments.colProvider"),
                        render: (row) => row.provider,
                      },
                      {
                        key: "amount",
                        header: t("payments.colAmount"),
                        align: "right",
                        render: (row) => (
                          <Currency amountMinor={row.amountMinor} currency={row.currency ?? "TZS"} />
                        ),
                      },
                      {
                        key: "status",
                        header: t("payments.colStatus"),
                        render: (row) => (
                          <StatusBadge
                            status={row.status === "confirmed" ? "success" : "pending"}
                            label={row.status}
                          />
                        ),
                      },
                    ]}
                    rows={savedPayments}
                    getRowKey={(row) => row.id}
                  />
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      <Modal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title={t("payments.recordPayment")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPayOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={submitPayment} loading={payments.record.isPending}>
              {t("common.confirm")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {payError ? (
            <p role="alert" className="rounded-card bg-red-50 px-4 py-2 text-sm text-danger">
              {payError}
            </p>
          ) : null}
          <Input
            label={t("payments.amount")}
            type="number"
            min={0}
            value={payAmountMajor}
            onChange={(e) => setPayAmountMajor(e.target.value)}
          />
          <Select
            label={t("payments.provider")}
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            options={PROVIDERS.filter((p) => p !== "stripe" || stripeConfigured).map((p) => ({
              value: p,
              label: t(`payments.provider_${p}` as Parameters<typeof t>[0]),
            }))}
          />
          {!stripeConfigured ? (
            <p className="text-xs text-muted" title={t("payments.stripeDisabled")}>
              {t("payments.stripeDisabled")}
            </p>
          ) : null}
          {provider === "mobile_money" ? (
            <Input
              label={t("payments.txnCode")}
              value={providerRef}
              onChange={(e) => setProviderRef(e.target.value.toUpperCase())}
              placeholder="XXXXXXXXXX"
              hint={t("payments.txnHint")}
            />
          ) : (
            <Input
              label={t("payments.reference")}
              value={providerRef}
              onChange={(e) => setProviderRef(e.target.value)}
            />
          )}
          <Input
            label={t("payments.notes")}
            value={payNotes}
            onChange={(e) => setPayNotes(e.target.value)}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={voidOpen}
        title={t("invoices.voidTitle")}
        message={t("invoices.voidBody")}
        confirmLabel={t("invoices.voidConfirm")}
        cancelLabel={t("common.cancel")}
        danger
        loading={invoices.voidInvoice.isPending}
        onConfirm={confirmVoid}
        onCancel={() => setVoidOpen(false)}
      />
    </div>
  );
}
