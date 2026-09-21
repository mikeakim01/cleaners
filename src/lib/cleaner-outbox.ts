/**
 * Offline tolerance for the cleaner mobile shell (Phase 7 Track T).
 *
 * - Today's jobs are cached to localStorage with a timestamp so the Jobs tab
 *   still renders offline (flagged as saved data by the UI).
 * - Status updates that fail to send are queued in an outbox and retried via
 *   flushOutbox() on the `online` event and via a manual Retry button.
 *
 * All helpers are SSR-safe (no-ops / nulls when `window` is unavailable).
 */

import { updateJobStatusAction } from "@/app/actions/jobs.actions";
import type { ActionResult } from "@/lib/trackf-types";
import type { CleanerJob } from "@/lib/cleaner-types";

export interface StatusOutboxEntry {
  id: string;
  jobId: string;
  /** Service-case status, e.g. EN_ROUTE. */
  to: string;
  attempts: number;
  createdAt: string;
}

export interface CachedCleanerJobs {
  cachedAt: string;
  jobs: CleanerJob[];
}

const jobsKey = (tenant: string) => `cleaner:jobs:${tenant}`;
const outboxKey = (tenant: string) => `cleaner:outbox:${tenant}`;

export const OUTBOX_EVENT = "cleaner:outbox-changed";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function notifyOutboxChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OUTBOX_EVENT));
}

function readJson<T>(key: string): T | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or privacy mode: caching is best-effort, never fatal.
  }
}

export function readCachedJobs(tenant: string): CachedCleanerJobs | null {
  const cached = readJson<CachedCleanerJobs>(jobsKey(tenant));
  if (!cached || !Array.isArray(cached.jobs)) return null;
  return cached;
}

export function writeCachedJobs(tenant: string, jobs: CleanerJob[]): void {
  writeJson(jobsKey(tenant), {
    cachedAt: new Date().toISOString(),
    jobs,
  } satisfies CachedCleanerJobs);
}

export function readOutbox(tenant: string): StatusOutboxEntry[] {
  const entries = readJson<StatusOutboxEntry[]>(outboxKey(tenant));
  return Array.isArray(entries) ? entries : [];
}

function writeOutbox(tenant: string, entries: StatusOutboxEntry[]): void {
  writeJson(outboxKey(tenant), entries);
  notifyOutboxChanged();
}

export function queuedCount(tenant: string): number {
  return readOutbox(tenant).length;
}

export function queueStatusUpdate(
  tenant: string,
  jobId: string,
  to: string,
): StatusOutboxEntry {
  const entries = readOutbox(tenant);
  const entry: StatusOutboxEntry = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    jobId,
    to,
    attempts: 0,
    createdAt: new Date().toISOString(),
  };
  // One pending update per job: latest intent wins.
  const rest = entries.filter((e) => e.jobId !== jobId);
  writeOutbox(tenant, [...rest, entry]);
  return entry;
}

function isTransportFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return (
    /failed to fetch|network|load failed|offline|timeout|fetch failed/i.test(
      message,
    ) || (typeof navigator !== "undefined" && !navigator.onLine)
  );
}

/**
 * Try an immediate send; queue on transport failure. Validation/server
 * rejections are returned as errors (queueing them would just fail again).
 */
export async function pushStatusUpdate(
  tenant: string,
  jobId: string,
  to: string,
): Promise<{ ok: true; queued: boolean } | { ok: false; error: string }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    queueStatusUpdate(tenant, jobId, to);
    return { ok: true, queued: true };
  }
  try {
    const res = (await updateJobStatusAction(
      tenant,
      jobId,
      to,
    )) as ActionResult<unknown>;
    if (res.ok) return { ok: true, queued: false };
    if (isTransportFailure(res.error)) {
      queueStatusUpdate(tenant, jobId, to);
      return { ok: true, queued: true };
    }
    return { ok: false, error: res.error };
  } catch (err) {
    if (isTransportFailure(err)) {
      queueStatusUpdate(tenant, jobId, to);
      return { ok: true, queued: true };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Something went wrong.",
    };
  }
}

/** Send every queued update; drop successes, keep failures with attempts+1. */
export async function flushOutbox(
  tenant: string,
): Promise<{ sent: number; remaining: number }> {
  const entries = readOutbox(tenant);
  if (entries.length === 0) return { sent: 0, remaining: 0 };
  let sent = 0;
  const remaining: StatusOutboxEntry[] = [];
  for (const entry of entries) {
    try {
      const res = (await updateJobStatusAction(
        tenant,
        entry.jobId,
        entry.to,
      )) as ActionResult<unknown>;
      if (res.ok) {
        sent += 1;
      } else {
        remaining.push({ ...entry, attempts: entry.attempts + 1 });
      }
    } catch {
      remaining.push({ ...entry, attempts: entry.attempts + 1 });
    }
  }
  writeOutbox(tenant, remaining);
  return { sent, remaining: remaining.length };
}

export function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

export function subscribeOnline(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  window.addEventListener(OUTBOX_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
    window.removeEventListener(OUTBOX_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
