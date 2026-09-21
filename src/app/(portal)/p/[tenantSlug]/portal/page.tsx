import { PortalClient } from "./Client";

export default async function PortalPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  return <PortalClient slug={tenantSlug} />;
}
