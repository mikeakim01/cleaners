"use client";

import { useState } from "react";
import { Check, MapPin, Navigation, Sparkles } from "lucide-react";
import { Button } from "@/components/ui";
import { t } from "@/i18n";
import { usePushJobStatus } from "@/hooks/useCleanerJobs";
import type { CleanerJob } from "@/lib/cleaner-types";

interface NextStep {
  to: string;
  label: string;
  icon: React.ReactNode;
}

/** ONE big state-dependent action per job. Returns null when terminal. */
export function nextStepFor(status: string): NextStep | null {
  switch (status.toLowerCase()) {
    case "scheduled":
    case "assigned":
      return {
        to: "EN_ROUTE",
        label: t("cleaner.startRoute"),
        icon: <Navigation size={18} aria-hidden="true" />,
      };
    case "en_route":
      return {
        to: "ARRIVED",
        label: t("cleaner.arrived"),
        icon: <MapPin size={18} aria-hidden="true" />,
      };
    case "arrived":
      return {
        to: "IN_PROGRESS",
        label: t("cleaner.startCleaning"),
        icon: <Sparkles size={18} aria-hidden="true" />,
      };
    case "in_progress":
      return {
        to: "COMPLETED",
        label: t("cleaner.complete"),
        icon: <Check size={18} aria-hidden="true" />,
      };
    default:
      return null;
  }
}

export function JobActionButton({
  tenantSlug,
  job,
  beforeCount,
  afterCount,
}: {
  tenantSlug: string;
  job: CleanerJob;
  beforeCount: number;
  afterCount: number;
}) {
  const push = usePushJobStatus(tenantSlug);
  const [notice, setNotice] = useState<string | null>(null);
  const step = nextStepFor(job.status);
  if (!step) return null;

  const completing = step.to === "COMPLETED";
  const photosReady = beforeCount >= 1 && afterCount >= 1;

  const handleClick = () => {
    setNotice(null);
    if (completing && !photosReady) {
      setNotice(t("cleaner.needPhotos"));
      return;
    }
    push.mutate(
      { jobId: job.jobId, from: job.status, to: step.to },
      {
        onSuccess: (result) => {
          if (result.queued) setNotice(t("cleaner.statusQueued"));
        },
        onError: (err) => {
          setNotice(
            err instanceof Error ? err.message : t("common.errorGeneric"),
          );
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        size="lg"
        onClick={handleClick}
        loading={push.isPending}
        className="min-h-12 w-full text-base"
        aria-label={`${step.label}: ${job.reference}`}
      >
        {step.icon}
        {step.label}
      </Button>
      {notice ? (
        <p role={push.isError ? "alert" : "status"} className="text-sm text-muted">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
