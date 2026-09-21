"use client";

import { useState } from "react";
import {
  Button,
  Currency,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  StatusBadge,
} from "@/components/ui";
import type { StatusKind } from "@/components/ui/StatusBadge";
import { useQuotes } from "@/hooks/useQuotes";
import { t } from "@/i18n";
import type { Quote } from "@/lib/trackf-types";

const KIND_BY_STATUS: Record<string, StatusKind> = {
  draft: "pending",
  sent: "info",
  approved: "success",
  rejected: "danger",
  expired: "warning",
};

export function QuotesClient({
  tenantId,
  initial,
}: {
  tenantId: string;
  initial: Quote[];
}) {
  const { list, create, send, approve } = useQuotes(tenantId);
  const [open, setOpen] = useState(false);
  const [bookingRef, setBookingRef] = useState("");
  const [total, setTotal] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const rows = list.data ?? initial;

  const submit = async () => {
    setFeedback(null);
    try {
      await create.mutateAsync({
        bookingReference: bookingRef,
        totalMinor: Number(total) || 0,
      });
      setFeedback(t("quotes.createSuccess"));
      setOpen(false);
      setBookingRef("");
      setTotal("");
    } catch (e) {
      setFeedback((e as Error).message);
    }
  };

  const act = async (
    fn: (id: string) => Promise<Quote>,
    id: string,
    okMsg: string,
  ) => {
    setFeedback(null);
    try {
      await fn(id);
      setFeedback(okMsg);
    } catch (e) {
      setFeedback((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t("quotes.title")}</h1>
          <p className="text-sm text-muted">{t("quotes.subtitle")}</p>
        </div>
        <Button className="ml-auto" size="sm" onClick={() => setOpen(true)}>
          {t("quotes.createQuote")}
        </Button>
      </div>

      {feedback ? (
        <p role="status" className="rounded-card bg-tint px-4 py-2 text-sm text-primary">
          {feedback}
        </p>
      ) : null}

      {list.isPending && rows.length === 0 ? (
        <LoadingState label={t("common.loading")} />
      ) : list.isError && rows.length === 0 ? (
        <ErrorState
          message={(list.error as Error).message}
          onRetry={() => list.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : rows.length === 0 ? (
        <EmptyState title={t("quotes.emptyTitle")} description={t("quotes.emptyBody")} />
      ) : (
        <DataTable<Quote>
          columns={[
            { key: "ref", header: t("quotes.colRef"), render: (r) => r.reference },
            { key: "booking", header: t("quotes.bookingRef"), render: (r) => r.bookingReference ?? "" },
            { key: "customer", header: t("quotes.colCustomer"), render: (r) => r.customerName ?? "" },
            {
              key: "total",
              header: t("quotes.colTotal"),
              align: "right",
              render: (r) => (
                <Currency amountMinor={r.totalMinor} currency={r.currency ?? "TZS"} />
              ),
            },
            {
              key: "status",
              header: t("quotes.colStatus"),
              render: (r) => (
                <StatusBadge status={KIND_BY_STATUS[r.status] ?? "pending"} label={r.status} />
              ),
            },
            {
              key: "actions",
              header: t("common.actions"),
              render: (r) => (
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={send.isPending}
                    onClick={() => act((id) => send.mutateAsync(id), r.id, t("quotes.sendSuccess"))}
                  >
                    {t("quotes.send")}
                  </Button>
                  <Button
                    size="sm"
                    loading={approve.isPending}
                    onClick={() =>
                      act((id) => approve.mutateAsync(id), r.id, t("quotes.approveSuccess"))
                    }
                  >
                    {t("quotes.approve")}
                  </Button>
                </span>
              ),
            },
          ]}
          rows={rows}
          getRowKey={(r) => r.id}
        />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={t("quotes.createQuote")}>
        <div className="flex flex-col gap-3">
          <Input
            label={t("quotes.bookingRef")}
            value={bookingRef}
            onChange={(e) => setBookingRef(e.target.value)}
          />
          <Input
            label={t("quotes.colTotal")}
            inputMode="numeric"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} loading={create.isPending} disabled={!bookingRef.trim()}>
            {t("common.save")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
