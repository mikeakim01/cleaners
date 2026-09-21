"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import {
  Avatar,
  Button,
  Currency,
  DatePicker,
  Drawer,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
} from "@/components/ui";
import { useCalendar } from "@/hooks/useCalendar";
import { formatDate } from "@/lib/format";
import { t } from "@/i18n";
import type { DaySchedule } from "@/lib/trackf-types";

type View = "day" | "week";

function shiftISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekStrip(centerISO: string): string[] {
  const d = new Date(`${centerISO}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - dow);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday);
    day.setUTCDate(monday.getUTCDate() + i);
    return day.toISOString().slice(0, 10);
  });
}

export function CalendarClient({
  tenantId,
  initialDate,
  initial,
}: {
  tenantId: string;
  initialDate: string;
  initial: DaySchedule | null;
}) {
  const [view, setView] = useState<View>("day");
  const [date, setDate] = useState(initialDate);
  const [queueOpen, setQueueOpen] = useState(false);

  const schedule = useCalendar(tenantId, date);
  const data = schedule.data ?? (date === initialDate ? initial : null);

  const strip = useMemo(() => weekStrip(date), [date]);
  const conflicts = data?.conflicts ?? [];
  const unassigned = data?.unassigned ?? [];
  const crews = data?.crews ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold tracking-tight">{t("calendar.title")}</h1>
        <span
          role="tablist"
          aria-label={t("calendar.title")}
          className="ml-auto flex rounded-input border border-border bg-surface p-0.5"
        >
          {(["day", "week"] as View[]).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`rounded-input px-3 py-1.5 text-sm font-medium ${
                view === v ? "bg-primary text-white" : "text-muted hover:text-ink"
              }`}
            >
              {v === "day" ? t("calendar.day") : t("calendar.week")}
            </button>
          ))}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setDate((d) => shiftISO(d, -1))}>
          {t("common.prev")}
        </Button>
        <DatePicker aria-label={t("calendar.pickDate")} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <Button size="sm" variant="secondary" onClick={() => setDate((d) => shiftISO(d, 1))}>
          {t("common.next")}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setQueueOpen(true)}>
          {t("calendar.unassignedQueue")} ({unassigned.length})
        </Button>
      </div>

      {view === "week" ? (
        <div className="grid grid-cols-7 gap-1">
          {strip.map((d) => (
            <button
              key={d}
              onClick={() => {
                setDate(d);
                setView("day");
              }}
              aria-pressed={d === date}
              className={`rounded-input border px-1 py-2 text-center ${
                d === date ? "border-primary bg-tint" : "border-border bg-surface"
              }`}
            >
              <span className="block text-[10px] uppercase text-muted">
                {new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short" })}
              </span>
              <span className="block text-sm font-bold tabular-nums">{d.slice(8, 10)}</span>
            </button>
          ))}
        </div>
      ) : null}

      {conflicts.length > 0 ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-card border border-danger/30 bg-red-50 px-4 py-3"
        >
          <TriangleAlert size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
          <div>
            <p className="text-sm font-bold text-danger">{t("calendar.conflictTitle")}</p>
            <ul className="mt-1 flex flex-col gap-0.5 text-sm text-danger">
              {conflicts.map((c, i) => (
                <li key={i}>{c.message}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <h2 className="text-sm font-semibold text-zinc-500">
        {t("calendar.bookingsFor")} <span className="tabular-nums">{formatDate(`${date}T00:00:00Z`)}</span>
      </h2>

      {schedule.isPending && !data ? (
        <LoadingState label={t("common.loading")} />
      ) : schedule.isError && !data ? (
        <ErrorState
          message={(schedule.error as Error).message}
          onRetry={() => schedule.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <section className="rounded-card border border-border bg-surface p-4">
            <h3 className="text-sm font-semibold text-zinc-500">{t("calendar.capacity")}</h3>
            {crews.length === 0 ? (
              <p className="mt-1 text-sm text-muted">{t("calendar.conflictsNone")}</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {crews.map((c) => {
                  const pct = c.capacity > 0 ? Math.min(100, (c.booked / c.capacity) * 100) : 0;
                  return (
                    <li key={c.teamId} className="flex flex-col gap-1">
                      <span className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 font-medium">
                          <Avatar name={c.teamName} size="sm" />
                          {c.teamName}
                        </span>
                        <span className="tabular-nums text-muted">
                          {c.booked} {t("calendar.bookedOf")} {c.capacity}
                        </span>
                      </span>
                      <span
                        className="h-1.5 overflow-hidden rounded-full bg-canvas"
                        role="progressbar"
                        aria-valuenow={c.booked}
                        aria-valuemin={0}
                        aria-valuemax={c.capacity}
                        aria-label={c.teamName}
                      >
                        <span
                          className={`block h-full rounded-full ${c.booked > c.capacity ? "bg-danger" : "bg-primary"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}

      <Drawer
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        title={t("calendar.unassignedQueue")}
      >
        {unassigned.length === 0 ? (
          <EmptyState title={t("calendar.unassignedQueue")} description={t("calendar.unassignedNone")} />
        ) : (
          <ul className="flex flex-col gap-2">
            {unassigned.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-2 rounded-input border border-border px-3 py-2"
              >
                <span className="min-w-0">
                  <Link
                    href={`/${tenantId}/bookings/${b.reference}`}
                    className="block truncate text-sm font-semibold text-primary hover:underline"
                  >
                    {b.reference}
                  </Link>
                  <span className="block truncate text-xs text-muted">
                    {b.customerName} · {b.serviceName}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Currency amountMinor={b.totalMinor} currency={b.currency ?? "TZS"} />
                  <StatusBadge status="warning" label={b.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Drawer>
    </div>
  );
}
