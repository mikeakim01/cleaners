import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { t, type TranslationKey } from "@/i18n";
import { isTerminalStatus } from "@/lib/trackf-types";

export interface TimelineEntry {
  status: string;
  at: string;
}

export interface BookingTimelineProps {
  status: string;
  history?: TimelineEntry[];
}

interface Stage {
  key: string;
  labelKey: TranslationKey;
}

const STAGES: Stage[] = [
  { key: "pending", labelKey: "bookingStatus.pending" },
  { key: "confirmed", labelKey: "bookingStatus.confirmed" },
  { key: "scheduled", labelKey: "bookingStatus.scheduled" },
  { key: "assigned", labelKey: "bookingStatus.assigned" },
  { key: "en_route", labelKey: "bookingStatus.enRoute" },
  { key: "arrived", labelKey: "bookingStatus.arrived" },
  { key: "in_progress", labelKey: "bookingStatus.inProgress" },
  { key: "quality_check", labelKey: "bookingStatus.qualityCheck" },
  { key: "completed", labelKey: "bookingStatus.completed" },
  { key: "invoiced", labelKey: "bookingStatus.invoiced" },
  { key: "paid", labelKey: "bookingStatus.paid" },
];

/** Display mapping of every known state onto the main path (incl. quote branch). */
const STAGE_INDEX: Record<string, number> = {
  pending: 0,
  quote_sent: 0,
  quote_approved: 1,
  confirmed: 1,
  scheduled: 2,
  assigned: 3,
  en_route: 4,
  arrived: 5,
  in_progress: 6,
  on_hold: 6,
  quality_check: 7,
  completed: 8,
  invoiced: 9,
  paid: 10,
};

const TERMINAL_LABEL: Record<string, TranslationKey> = {
  cancelled: "bookingStatus.cancelled",
  rejected: "bookingStatus.rejected",
};

function dateFor(history: TimelineEntry[], stageKey: string, fallbackStatuses: string[]): string {
  const entry = history.find(
    (h) => h.status === stageKey || fallbackStatuses.includes(h.status),
  );
  return entry ? formatDate(entry.at) : "";
}

const FALLBACKS: Record<string, string[]> = {
  pending: ["quote_sent"],
  confirmed: ["quote_approved"],
  in_progress: ["on_hold"],
};

export function BookingTimeline({ status, history = [] }: BookingTimelineProps) {
  const terminal = isTerminalStatus(status);
  const current = STAGE_INDEX[status] ?? 0;
  const reached = terminal
    ? history.reduce((max, h) => Math.max(max, STAGE_INDEX[h.status] ?? 0), 0)
    : current;

  return (
    <div className="overflow-x-auto pb-1" role="list" aria-label="Booking progress">
      <ol className="flex min-w-max items-start gap-0">
        {STAGES.map((stage, i) => {
          if (terminal && i > reached) return null;
          const isCurrent = !terminal && i === current;
          const isDone = terminal ? i <= reached : i < current;
          const date = dateFor(history, stage.key, FALLBACKS[stage.key] ?? []);
          return (
            <li key={stage.key} role="listitem" className="flex items-start">
              <div className="flex w-20 flex-col items-center gap-1 text-center">
                <span
                  aria-current={isCurrent ? "step" : undefined}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full border text-xs font-bold",
                    isDone
                      ? "border-primary bg-primary text-white"
                      : isCurrent
                        ? "border-primary bg-tint text-primary ring-2 ring-primary/30"
                        : "border-border bg-canvas text-faint",
                  )}
                >
                  {isDone ? (
                    <Check size={18} aria-hidden="true" />
                  ) : isCurrent ? (
                    <span aria-hidden="true" className="size-2 rounded-full bg-current" />
                  ) : (
                    <Minus size={18} aria-hidden="true" />
                  )}
                </span>
                <span
                  className={cn(
                    "text-[11px] font-semibold leading-tight",
                    isDone || isCurrent ? "text-ink" : "text-faint",
                  )}
                >
                  {t(stage.labelKey)}
                </span>
                {date ? (
                  <span className="text-[10px tabular-nums text-muted">{date}</span>
                ) : null}
              </div>
              {i < STAGES.length - 1 && !(terminal && i === reached) ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-3.5 h-0.5 w-6 shrink-0 rounded",
                    i < reached || (isDone && terminal) || (!terminal && i < current)
                      ? "bg-primary"
                      : "bg-border",
                  )}
                />
              ) : null}
            </li>
          );
        })}
        {terminal ? (
          <li role="listitem" className="flex items-start">
            <span aria-hidden="true" className="mt-3.5 h-0.5 w-6 shrink-0 rounded bg-danger" />
            <div className="flex w-20 flex-col items-center gap-1 text-center">
              <span className="flex size-7 items-center justify-center rounded-full border border-danger bg-red-50 text-xs font-bold text-danger">
                ×
              </span>
              <span className="text-[11px] font-semibold leading-tight text-danger">
                {t(TERMINAL_LABEL[status] ?? "bookingStatus.cancelled")}
              </span>
              {(() => {
                const entry = [...history].reverse().find((h) => h.status === status);
                return entry ? (
                  <span className="text-[10px tabular-nums text-muted">
                    {formatDate(entry.at)}
                  </span>
                ) : null;
              })()}
            </div>
          </li>
        ) : null}
      </ol>
    </div>
  );
}
