import { cn } from "@/lib/cn";

export type StatusKind =
  | "pending"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "success"
  | "warning"
  | "danger"
  | "info";

export interface StatusBadgeProps {
  status: StatusKind;
  label: string;
}

const styles: Record<StatusKind, string> = {
  pending: "bg-canvas text-muted border-border",
  confirmed: "bg-tint text-primary border-primary/20",
  in_progress: "bg-blue-50 text-info border-info/20",
  completed: "bg-tint text-success border-success/20",
  cancelled: "bg-red-50 text-danger border-danger/20",
  success: "bg-tint text-success border-success/20",
  warning: "bg-amber-50 text-warning border-warning/20",
  danger: "bg-red-50 text-danger border-danger/20",
  info: "bg-blue-50 text-info border-info/20",
};

export function StatusBadge({ status, label }: StatusBadgeProps) {
  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
        styles[status],
      )}
    >
      <span
        aria-hidden="true"
        className="inline-block size-1.5 rounded-full bg-current"
      />
      {label}
    </span>
  );
}
