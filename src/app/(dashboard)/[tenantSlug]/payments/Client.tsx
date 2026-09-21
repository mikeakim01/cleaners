"use client";

import { useMemo, useState } from "react";
import { HandCoins, Plus } from "lucide-react";
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
import { usePayments } from "@/hooks/usePayments";
import { formatDate } from "@/lib/format";
import { t } from "@/i18n";
import type { PaymentListData } from "@/lib/tracki-types";

const PROVIDERS = ["cash", "bank_transfer", "mobile_money", "payment_link"];
const MPESA_REF_RE = /^[A-Z0-9]{8,12}$/;

export function PaymentsClient({
  tenantId,
  initial,
}: {
  tenantId: string;
  initial: PaymentListData | null;
}) {
  const query = usePayments(tenantId);
  const data = query.data ?? initial;
  const rows = useMemo(() => data?.rows ?? [], [data]);

  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [invoiceRef, setInvoiceRef] = useState("");
  const [amountMajor, setAmountMajor] = useState("");
  const [provider, setProvider] = useState("cash");
  const [providerRef, setProviderRef] = useState("");
  const [notes, setNotes] = useState("");

  const submit = async () => {
    setFormError(null);
    const amountMinor = Math.round(Number(amountMajor) * 100);
    if (!invoiceRef.trim()) {
      setFormError(t("payments.invoiceRequired"));
      return;
    }
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      setFormError(t("payments.amountInvalid"));
      return;
    }
    if (provider === "mobile_money" && !MPESA_REF_RE.test(providerRef.trim())) {
      setFormError(t("payments.mpesaRefInvalid"));
      return;
    }
    try {
      await query.record.mutateAsync({
        invoiceId: invoiceRef.trim(),
        amountMinor,
        provider,
        providerRef: providerRef.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setOpen(false);
      setFeedback(t("payments.recordSuccess"));
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">{t("payments.title")}</h1>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus size={18} aria-hidden="true" />
          {t("payments.recordPayment")}
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
          title={t("payments.emptyTitle")}
          description={t("payments.emptyBody")}
          icon={<HandCoins size={18} aria-hidden="true" />}
          action={
            <Button size="sm" onClick={() => setOpen(true)}>
              {t("payments.recordPayment")}
            </Button>
          }
        />
      ) : (
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
              key: "invoice",
              header: t("payments.colInvoice"),
              render: (row) => (
                <span className="font-semibold tabular-nums">
                  {row.invoiceReference ?? row.invoiceId ?? "—"}
                </span>
              ),
            },
            {
              key: "customer",
              header: t("payments.colCustomer"),
              render: (row) => row.customerName ?? "—",
            },
            {
              key: "provider",
              header: t("payments.colProvider"),
              render: (row) => row.provider,
            },
            {
              key: "ref",
              header: t("payments.colRef"),
              render: (row) => (
                <span className="tabular-nums">{row.providerRef ?? "—"}</span>
              ),
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
              render: (row) =>
                row.provider === "mobile_money" && row.status === "pending" ? (
                  <StatusBadge status="warning" label={t("payments.mpesaPending")} />
                ) : (
                  <StatusBadge
                    status={row.status === "confirmed" ? "success" : "pending"}
                    label={row.status}
                  />
                ),
            },
          ]}
          rows={rows}
          getRowKey={(row) => row.id}
        />
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("payments.recordPayment")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={submit} loading={query.record.isPending}>
              {t("common.confirm")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {formError ? (
            <p role="alert" className="rounded-card bg-red-50 px-4 py-2 text-sm text-danger">
              {formError}
            </p>
          ) : null}
          <Input
            label={t("payments.invoiceRef")}
            value={invoiceRef}
            onChange={(e) => setInvoiceRef(e.target.value)}
            placeholder="INV-…"
          />
          <Input
            label={t("payments.amount")}
            type="number"
            min={0}
            value={amountMajor}
            onChange={(e) => setAmountMajor(e.target.value)}
          />
          <Select
            label={t("payments.provider")}
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            options={PROVIDERS.map((p) => ({
              value: p,
              label: t(`payments.provider_${p}` as Parameters<typeof t>[0]),
            }))}
          />
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
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </Modal>
    </div>
  );
}
