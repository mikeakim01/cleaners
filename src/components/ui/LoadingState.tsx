import { Loader2 } from "lucide-react";

export interface LoadingStateProps {
  label?: string;
}

export function LoadingState({ label = "Loading…" }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className="flex flex-col items-center gap-2 rounded-card border border-border bg-surface px-6 py-10"
    >
      <Loader2 size={18} className="animate-spin text-primary" aria-hidden="true" />
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}
