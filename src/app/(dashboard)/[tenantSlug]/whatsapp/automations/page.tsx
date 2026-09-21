import { AutomationsClient } from "./Client";

export default async function WhatsAppAutomationsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  return <AutomationsClient tenantId={tenantSlug} />;
}
