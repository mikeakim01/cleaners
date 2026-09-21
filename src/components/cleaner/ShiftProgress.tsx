import { t } from "@/i18n";
import { cn } from "@/lib/cn";

const STEPS = [
  { key: "route", labelKey: "cleaner.shiftRoute" },
  { key: "arrived", labelKey: "cleaner.shiftArrived" },
  { key: "clean", labelKey: "cleaner.shiftClean" },
  { key: "verify", labelKey: "cleaner.shiftVerify" },
] as const;

/** 0-based index of the current step, -1 when not started, 4 when done. */
export function stepIndexForStatus(status: string): number {
  switch (status.toLowerCase()) {
    case "en_route":
      return 0;
    case "arrived":
      return 1;
    case "in_progress":
      return 2;
    case "completed":
      return 4;
    default:
      return -1;
  }
}

export function ShiftProgress({ status }: { status: string }) {
  const current = stepIndexForStatus(status);
  return (
    <ol
      aria-label={t("cleaner.shiftProgress")}
      className="flex items-center gap-1.5"
    >
      {STEPS.map((step, i) => {
        const done = current === 4 || i < current;
        const active = i === current;
        return (
          <li key={step.key} className="flex flex-1 items-center gap-1.5">
            <span className="flex flex-1 flex-col gap-1">
              <span
                aria-hidden="true"
                className={cn(
                  "h-1.5 rounded-full",
                  done || active ? "bg-primary" : "bg-border",
                )}
              />
              <span
                className={cn(
                  "text-[11px] font-medium",
                  done || active ? "text-ink" : "text-muted",
                )}
                aria-current={active ? "step" : undefined}
              >
                {t(step.labelKey)}
              </span>
            </span>
            {i < STEPS.length - 1 ? (
              <span aria-hidden="true" className="sr-only">
                {" "}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
