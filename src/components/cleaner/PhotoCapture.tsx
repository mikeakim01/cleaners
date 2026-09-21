"use client";

import { useRef } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { t } from "@/i18n";
import { useJobPhotos } from "@/hooks/useCleanerJobs";
import type { JobPhotoKind } from "@/lib/cleaner-types";
import { cn } from "@/lib/cn";

function KindSection({
  tenantSlug,
  jobId,
  kind,
  title,
}: {
  tenantSlug: string;
  jobId: string;
  kind: JobPhotoKind;
  title: string;
}) {
  const { photos, capture, remove, capturing } = useJobPhotos(
    tenantSlug,
    jobId,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const items = photos.filter((p) => p.kind === kind);

  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">
          {title} · {items.length}
        </h3>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={capturing}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-input border border-border bg-surface px-3 text-sm font-medium text-ink disabled:opacity-50"
        >
          <Camera size={18} aria-hidden="true" />
          {t("cleaner.capturePhoto")}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          aria-label={`${t("cleaner.capturePhoto")}: ${title}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void capture(kind, file);
          }}
        />
      </div>
      {items.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2">
          {items.map((photo) => (
            <li
              key={photo.id}
              className="relative overflow-hidden rounded-input border border-border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.url}
                alt={`${title} — ${photo.createdAt}`}
                className="aspect-square w-full object-cover"
              />
              <span
                className={cn(
                  "absolute left-1 top-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                  photo.state === "confirmed" &&
                    "bg-emerald-600 text-white",
                  photo.state === "pending" && "bg-amber-500 text-white",
                  photo.state === "failed" && "bg-danger text-white",
                  photo.state === "uploading" && "bg-ink/70 text-white",
                )}
              >
                {photo.state === "uploading" ? (
                  <Loader2 size={18} className="size-3 animate-spin" aria-hidden="true" />
                ) : null}
                {photo.state === "uploading"
                  ? t("cleaner.uploading")
                  : photo.state === "confirmed"
                    ? t("common.success")
                    : t("cleaner.pendingUpload")}
              </span>
              <button
                type="button"
                onClick={() => remove(photo.id)}
                aria-label={`${t("cleaner.removePhoto")}: ${title}`}
                className="absolute right-1 top-1 rounded-full bg-ink/70 p-1.5 text-white"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function PhotoCapture({
  tenantSlug,
  jobId,
}: {
  tenantSlug: string;
  jobId: string;
}) {
  const { before, after, error } = useJobPhotos(tenantSlug, jobId);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-ink">
          {t("cleaner.photosTitle")}
        </h3>
        <p className="text-sm text-muted">{t("cleaner.photosHint")}</p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-warning">
          {error}
        </p>
      ) : null}
      <KindSection
        tenantSlug={tenantSlug}
        jobId={jobId}
        kind="before"
        title={`${t("cleaner.before")} (${before})`}
      />
      <KindSection
        tenantSlug={tenantSlug}
        jobId={jobId}
        kind="after"
        title={`${t("cleaner.after")} (${after})`}
      />
    </div>
  );
}
