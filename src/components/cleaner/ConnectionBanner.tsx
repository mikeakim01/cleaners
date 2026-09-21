"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Wifi, WifiOff } from "lucide-react";
import { t } from "@/i18n";
import { useFlushOutbox } from "@/hooks/useCleanerJobs";
import {
  flushOutbox,
  isOnline,
  queuedCount,
  subscribeOnline,
} from "@/lib/cleaner-outbox";
import { cn } from "@/lib/cn";

export function ConnectionBanner({ tenantSlug }: { tenantSlug: string }) {
  const [online, setOnline] = useState<boolean>(() => isOnline());
  const [queued, setQueued] = useState<number>(() => queuedCount(tenantSlug));
  const flush = useFlushOutbox(tenantSlug);

  useEffect(() => {
    const refresh = () => {
      setOnline(isOnline());
      setQueued(queuedCount(tenantSlug));
    };
    refresh();
    // Flush automatically when the browser comes back online.
    const onOnline = () => {
      refresh();
      void flushOutbox(tenantSlug).then(() => {
        setQueued(queuedCount(tenantSlug));
      });
    };
    window.addEventListener("online", onOnline);
    const unsubscribe = subscribeOnline(refresh);
    return () => {
      window.removeEventListener("online", onOnline);
      unsubscribe();
    };
  }, [tenantSlug]);

  const state = !online ? "offline" : queued > 0 ? "queued" : "online";

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-2 rounded-input border px-3 py-2 text-sm",
        state === "offline" && "border-danger/30 bg-red-50 text-danger",
        state === "queued" && "border-warning/30 bg-amber-50 text-amber-800",
        state === "online" && "border-success/20 bg-emerald-50 text-emerald-800",
      )}
    >
      {state === "offline" ? (
        <WifiOff size={18} aria-hidden="true" />
      ) : (
        <Wifi size={18} aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate font-medium">
        {!online
          ? t("cleaner.offline")
          : queued > 0
            ? `${t("cleaner.online")} · ${queued}`
            : t("cleaner.online")}
      </span>
      {queued > 0 ? (
        <button
          type="button"
          onClick={() => flush.mutate()}
          disabled={flush.isPending}
          className="inline-flex items-center gap-1 rounded-input px-2 py-1 text-sm font-semibold underline underline-offset-2 disabled:opacity-50"
        >
          <RefreshCw
            size={18}
            aria-hidden="true"
            className={flush.isPending ? "animate-spin" : undefined}
          />
          {t("cleaner.retry")}
        </button>
      ) : null}
    </div>
  );
}
