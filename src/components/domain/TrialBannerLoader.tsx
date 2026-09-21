import { getTrialInfoAction } from "@/app/actions/billing.actions";
import { TrialBanner } from "./TrialBanner";

/**
 * Server wrapper for the dashboard layout (which is a server component).
 * Fetches trial info via the billing action and renders nothing when the
 * tenant is not trialing/past-due or the service is unreachable.
 */
export async function TrialBannerLoader({
  tenantId,
  tenantSlug,
}: {
  tenantId: string;
  tenantSlug: string;
}) {
  let info: { status: string; daysLeft: number; planName: string } | null = null;
  try {
    const res = await getTrialInfoAction(tenantId);
    if (res.ok) info = res.data;
  } catch {
    info = null;
  }
  if (!info) return null;
  return (
    <TrialBanner
      status={info.status}
      daysLeft={info.daysLeft}
      planName={info.planName}
      tenantSlug={tenantSlug}
    />
  );
}
