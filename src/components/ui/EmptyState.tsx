import * as React from "react";
import { Inbox } from "lucide-react";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-2 rounded-card border border-border bg-surface px-6 py-10 text-center"
    >
      <span
        aria-hidden="true"
        className="flex size-11 items-center justify-center rounded-full bg-canvas text-muted"
      >
        {icon ?? <Inbox size={18} />}
      </span>
      <p className="font-heading text-base font-semibold text-ink">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
