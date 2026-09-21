import * as React from "react";
import { cn } from "@/lib/cn";
import { LoadingState } from "./LoadingState";
import { EmptyState } from "./EmptyState";

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  align?: "left" | "right" | "center";
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T, index: number) => string;
  loading?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
  caption?: string;
}

const alignCls = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
} as const;

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  loading = false,
  emptyTitle = "Nothing here yet",
  emptyBody,
  caption,
}: DataTableProps<T>) {
  if (loading) return <LoadingState />;
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyBody} />;
  }
  return (
    <div className="w-full overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-border bg-canvas">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  "px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted",
                  alignCls[c.align ?? "left"],
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={getRowKey(row, i)}
              className="border-b border-border last:border-0 hover:bg-canvas/60"
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    "px-4 py-3 text-ink",
                    alignCls[c.align ?? "left"],
                  )}
                >
                  {c.render
                    ? c.render(row)
                    : String(
                        (row as Record<string, unknown>)[c.key] ?? "",
                      )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
