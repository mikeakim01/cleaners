"use client";

import { useMemo, useState } from "react";
import { MessageSquareReply, Star } from "lucide-react";
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  Select,
} from "@/components/ui";
import { formatDate } from "@/lib/format";
import { t } from "@/i18n";
import { useReviewSummary, useReviews, type StaffReview } from "@/hooks/useReviews";

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} / 5`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          size={18}
          aria-hidden="true"
          className={s <= value ? "fill-amber-400 text-amber-400" : "text-zinc-300"}
        />
      ))}
    </span>
  );
}

export function ReviewsClient({
  tenantId,
  initial,
  initialSummary,
}: {
  tenantId: string;
  initial: StaffReview[] | null;
  initialSummary: { avg: number; count: number } | null;
}) {
  const { data, isPending, isError, error, refetch, respond } = useReviews(tenantId);
  const summaryQuery = useReviewSummary(tenantId);
  const [ratingFilter, setRatingFilter] = useState("");
  const [responding, setResponding] = useState<StaffReview | null>(null);
  const [response, setResponse] = useState("");
  const [respondError, setRespondError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const list = data ?? initial ?? [];
    return ratingFilter ? list.filter((r) => r.rating === Number(ratingFilter)) : list;
  }, [data, initial, ratingFilter]);

  const summary = summaryQuery.data ?? initialSummary;

  async function sendResponse() {
    if (!responding) return;
    if (response.trim().length < 2) {
      setRespondError("Please write a response first.");
      return;
    }
    setRespondError(null);
    try {
      await respond.mutateAsync({ reviewId: responding.id, response: response.trim() });
      setResponding(null);
      setResponse("");
    } catch (e) {
      setRespondError(e instanceof Error ? e.message : t("common.errorGeneric"));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t("reviews.title")}</h1>
        <p className="text-sm text-zinc-600">{t("reviews.subtitle")}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-zinc-100 bg-white p-4">
          <p className="text-xs font-medium text-zinc-500">{t("reviews.avgRating")}</p>
          {summary ? (
            <p className="mt-1 flex items-center gap-2">
              <span className="text-2xl font-bold tabular-nums">{summary.avg.toFixed(1)}</span>
              <Stars value={Math.round(summary.avg)} />
            </p>
          ) : (
            <p className="mt-1 text-2xl font-bold tabular-nums">–</p>
          )}
        </div>
        <div className="rounded-2xl border border-zinc-100 bg-white p-4">
          <p className="text-xs font-medium text-zinc-500">{t("reviews.totalReviews")}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{summary ? summary.count : "–"}</p>
        </div>
      </div>

      {/* Filter */}
      <div className="max-w-xs">
        <Select
          aria-label="Filter by rating"
          options={[
            { value: "5", label: "5 ★" },
            { value: "4", label: "4 ★" },
            { value: "3", label: "3 ★" },
            { value: "2", label: "2 ★" },
            { value: "1", label: "1 ★" },
          ]}
          placeholder={t("reviews.filterAll")}
          value={ratingFilter}
          onChange={(e) => setRatingFilter(e.target.value)}
        />
      </div>

      {isPending && !initial ? <LoadingState label={t("common.loading")} /> : null}
      {isError && !initial ? (
        <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
      ) : null}
      {rows.length === 0 && (data || initial) ? (
        <EmptyState
          title={t("reviews.emptyTitle")}
          description={t("reviews.emptyBody")}
          icon={<Star size={18} aria-hidden="true" />}
        />
      ) : null}
      {rows.length > 0 ? (
        <DataTable<StaffReview>
          columns={[
            {
              key: "booking",
              header: t("reviews.colBooking"),
              render: (r) => (
                <span>
                  <span className="block font-mono text-xs font-bold tabular-nums">{r.bookingReference}</span>
                  <span className="block text-xs text-zinc-500">{formatDate(r.createdAt)}</span>
                </span>
              ),
            },
            { key: "customer", header: t("reviews.colCustomer"), render: (r) => r.customerName },
            { key: "rating", header: t("reviews.colRating"), render: (r) => <Stars value={r.rating} /> },
            {
              key: "comment",
              header: t("reviews.colComment"),
              render: (r) => <span className="block max-w-xs truncate" title={r.comment}>{r.comment}</span>,
            },
            { key: "source", header: t("reviews.colSource"), render: (r) => <span className="text-xs capitalize">{r.source}</span> },
            {
              key: "response",
              header: t("reviews.colResponse"),
              render: (r) =>
                r.response ? (
                  <span className="block max-w-xs truncate text-emerald-700" title={r.response}>{r.response}</span>
                ) : (
                  <span className="text-xs text-zinc-400">—</span>
                ),
            },
            {
              key: "actions",
              header: t("common.actions"),
              render: (r) => (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => { setResponding(r); setResponse(r.response ?? ""); setRespondError(null); }}
                >
                  <MessageSquareReply size={18} aria-hidden="true" /> {t("reviews.respond")}
                </Button>
              ),
            },
          ]}
          rows={rows}
          getRowKey={(r) => r.id}
        />
      ) : null}

      <Modal
        open={responding !== null}
        onClose={() => setResponding(null)}
        title={t("reviews.respond")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setResponding(null)}>{t("common.cancel")}</Button>
            <Button loading={respond.isPending} onClick={sendResponse}>{t("reviews.send")}</Button>
          </>
        }
      >
        {responding ? (
          <div className="grid gap-3">
            <p className="text-sm text-zinc-600">
              {responding.customerName} · {responding.bookingReference} · {responding.rating}/5
            </p>
            <p className="rounded-xl bg-zinc-50 p-3 text-sm">“{responding.comment}”</p>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t("reviews.responseLabel")}
              <textarea
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                rows={3}
                className="rounded-xl border border-zinc-200 px-3 py-2 text-sm font-normal outline-none focus:border-emerald-600"
              />
            </label>
            {respondError ? <p role="alert" className="text-sm text-red-600">{respondError}</p> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
