import { TriangleAlert } from "lucide-react";
import { Button } from "./Button";

export interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorState({
  message,
  onRetry,
  retryLabel = "Try again",
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 rounded-card border border-danger/20 bg-surface px-6 py-10 text-center"
    >
      <span
        aria-hidden="true"
        className="flex size-11 items-center justify-center rounded-full bg-red-50 text-danger"
      >
        <TriangleAlert size={18} />
      </span>
      <p className="max-w-sm text-sm text-ink">{message}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
