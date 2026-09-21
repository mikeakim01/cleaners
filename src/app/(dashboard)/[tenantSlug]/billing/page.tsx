import { getBillingStateAction } from "@/app/actions/billing.actions";
import { mapBillingState } from "@/lib/admin-mappers";
import { BillingClient } from "./Client";

export default async function BillingPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  let initial = null;
  let initialError: string | null = null;
  try {
    const res = await getBillingStateAction(tenantSlug);
    if (res.ok) initial = mapBillingState(res.data);
    else initialError = res.error;
  } catch (err) {
    initialError = err instanceof Error ? err.message : "Error";
  }
  return (
    <BillingClient
      tenantId={tenantSlug}
      tenantSlug={tenantSlug}
      initial={initial}
      initialError={initialError}
    />
  );
}
