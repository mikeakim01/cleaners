import { ConnectClient } from "./Client";

export default async function WhatsAppConnectPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  return <ConnectClient tenantId={tenantSlug} />;
}
