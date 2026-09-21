import Link from "next/link";
import { AlertTriangle, Clock } from "lucide-react";
import { t } from "@/i18n";

export interface TrialBannerProps {
  status: string;
  daysLeft: number;
  planName: string;
  tenantSlug: string;
}

/** Renders only for `trialing` (amber) or `past_due` (red); null otherwise. */
export function TrialBanner({
  status,
  daysLeft,
  planName,
  tenantSlug,
}: TrialBannerProps) {
  if (status === "trialing") {
    const days =
      daysLeft === 1 ? t("billing.dayLeft") : t("billing.daysLeft");
    return (
      <div role="status" className="border-b border-amber-200 bg-amber-50">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-2 text-sm text-amber-900">
          <Clock size={18} aria-hidden="true" className="shrink-0" />
          <p className="min-w-0">
            {t("billing.trialEndsIn")} {daysLeft} {days}
            {planName ? ` · ${planName}` : ""} —{" "}
            <Link
              href={`/${tenantSlug}/billing`}
              className="font-semibold underline underline-offset-2"
            >
              {t("billing.upgrade")}
            </Link>
          </p>
        </div>
      </div>
    );
  }
  if (status === "past_due") {
    return (
      <div role="alert" className="border-b border-red-200 bg-red-50">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-2 text-sm text-red-900">
          <AlertTriangle size={18} aria-hidden="true" className="shrink-0" />
          <p className="min-w-0">
            {t("billing.trialEnded")} —{" "}
            <Link
              href={`/${tenantSlug}/billing`}
              className="font-semibold underline underline-offset-2"
            >
              {t("billing.updateBilling")}
            </Link>
          </p>
        </div>
      </div>
    );
  }
  return null;
}
