"use client";

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getMyJobsAction,
  getMyScheduleAction,
  uploadJobPhotoAction,
} from "@/app/actions/cleaner.actions";
import type {
  CleanerJob,
  CleanerScheduleDay,
  JobPhotoKind,
} from "@/lib/cleaner-types";
import { mapMyJob, mapSchedule } from "@/lib/cleaner-mappers";
import {
  flushOutbox,
  pushStatusUpdate,
  readCachedJobs,
  writeCachedJobs,
} from "@/lib/cleaner-outbox";

export interface CleanerJobsData {
  jobs: CleanerJob[];
  /** True when rendered from the offline cache. */
  fromCache: boolean;
  cachedAt: string | null;
}

/**
 * The service only allows SCHEDULED->ASSIGNED->EN_ROUTE, so a cleaner tapping
 * "Start route" on a SCHEDULED job sends ASSIGNED then EN_ROUTE in sequence.
 */
const CHAINED_FIRST_STEP: Record<string, string> = {
  SCHEDULED: "ASSIGNED",
};

function toServiceStatus(uiStatus: string): string {
  return uiStatus.toUpperCase();
}

export function useCleanerJobs(tenantSlug: string) {
  return useQuery<CleanerJobsData>({
    queryKey: ["cleaner-jobs", tenantSlug],
    queryFn: async (): Promise<CleanerJobsData> => {
      const res = await getMyJobsAction(tenantSlug, {});
      if (res.ok) {
        const jobs = res.data.map(mapMyJob);
        writeCachedJobs(tenantSlug, jobs);
        return {
          jobs,
          fromCache: false,
          cachedAt: new Date().toISOString(),
        };
      }
      const cached = readCachedJobs(tenantSlug);
      if (cached) {
        return { jobs: cached.jobs, fromCache: true, cachedAt: cached.cachedAt };
      }
      throw new Error(res.error);
    },
    staleTime: 15_000,
  });
}

export function useCleanerSchedule(tenantSlug: string, weekStart: string) {
  return useQuery({
    queryKey: ["cleaner-schedule", tenantSlug, weekStart],
    queryFn: async (): Promise<CleanerScheduleDay[]> => {
      const res = await getMyScheduleAction(tenantSlug, weekStart);
      if (!res.ok) throw new Error(res.error);
      return mapSchedule(res.data);
    },
    staleTime: 30_000,
  });
}

export interface PushStatusInput {
  jobId: string;
  from: string;
  to: string;
}

export function usePushJobStatus(tenantSlug: string) {
  const client = useQueryClient();
  const invalidate = () => {
    client.invalidateQueries({ queryKey: ["cleaner-jobs", tenantSlug] });
    client.invalidateQueries({ queryKey: ["cleaner-schedule", tenantSlug] });
  };

  return useMutation({
    mutationFn: async (
      input: PushStatusInput,
    ): Promise<{ queued: boolean }> => {
      const target = toServiceStatus(input.to);
      const chained = CHAINED_FIRST_STEP[input.from.toUpperCase()];
      // Chained first step must reach the server; a queued first step cannot
      // be followed by the second, so report it as queued and let flush
      // deliver it, then the cleaner retries the button.
      if (chained && chained !== target) {
        const first = await pushStatusUpdate(tenantSlug, input.jobId, chained);
        if (!first.ok) throw new Error(first.error);
        if (first.queued) return { queued: true };
      }
      const res = await pushStatusUpdate(tenantSlug, input.jobId, target);
      if (!res.ok) throw new Error(res.error);
      return { queued: res.queued };
    },
    onSuccess: invalidate,
  });
}

export function useFlushOutbox(tenantSlug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => flushOutbox(tenantSlug),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["cleaner-jobs", tenantSlug] });
      client.invalidateQueries({ queryKey: ["cleaner-schedule", tenantSlug] });
    },
  });
}

export type LocalPhotoState = "uploading" | "pending" | "confirmed" | "failed";

export interface LocalPhoto {
  id: string;
  kind: JobPhotoKind;
  createdAt: string;
  /** Data URL preview (device-local until the server accepts uploads). */
  url: string;
  state: LocalPhotoState;
}

const photosKey = (jobId: string) => `cleaner:photos:${jobId}`;

function readLocalPhotos(jobId: string): LocalPhoto[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(photosKey(jobId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalPhoto[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () =>
      reject(new Error("Could not read that photo. Please try again."));
    reader.readAsDataURL(file);
  });
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Device-local before/after captures. Each capture is previewed immediately
 * and an upload is attempted (GAP-3: the server rejects it for now, so the
 * photo stays `pending` and still counts toward the completion gate).
 */
export function useJobPhotos(tenantSlug: string, jobId: string) {
  const [photos, setPhotos] = useState<LocalPhoto[]>(() =>
    readLocalPhotos(jobId),
  );
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  // Reset per-job state when the hook moves to a different job (render-time
  // adjustment — the React-endorsed alternative to setState in an effect).
  const [currentJobId, setCurrentJobId] = useState(jobId);
  if (currentJobId !== jobId) {
    setCurrentJobId(jobId);
    setPhotos(readLocalPhotos(jobId));
    setError(null);
  }

  const persist = useCallback(
    (next: LocalPhoto[]) => {
      setPhotos(next);
      try {
        window.localStorage.setItem(photosKey(jobId), JSON.stringify(next));
      } catch {
        // Quota exceeded: keep in-memory previews for this session.
      }
    },
    [jobId],
  );

  const capture = useCallback(
    async (kind: JobPhotoKind, file: File) => {
      setError(null);
      setCapturing(true);
      try {
        const url = await fileToDataUrl(file);
        const photo: LocalPhoto = {
          id: newId(),
          kind,
          createdAt: new Date().toISOString(),
          url,
          state: "uploading",
        };
        const next = [...readLocalPhotos(jobId), photo];
        persist(next);
        const base64 = url.includes(",") ? url.split(",")[1] ?? "" : url;
        const res = await uploadJobPhotoAction(tenantSlug, jobId, {
          kind,
          contentBase64: base64,
          mime: file.type || "image/jpeg",
        });
        persist(
          (readLocalPhotos(jobId)).map((p) =>
            p.id === photo.id
              ? { ...p, state: res.ok ? ("confirmed" as const) : ("pending" as const) }
              : p,
          ),
        );
        if (!res.ok) setError(res.error);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not save that photo.",
        );
      } finally {
        setCapturing(false);
      }
    },
    [jobId, persist, tenantSlug],
  );

  const remove = useCallback(
    (id: string) => {
      persist(readLocalPhotos(jobId).filter((p) => p.id !== id));
    },
    [jobId, persist],
  );

  const before = photos.filter((p) => p.kind === "before").length;
  const after = photos.filter((p) => p.kind === "after").length;

  return { photos, before, after, capture, remove, error, capturing };
}
