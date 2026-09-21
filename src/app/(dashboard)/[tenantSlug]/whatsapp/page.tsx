import { WhatsAppClient } from "./Client";

export default async function WhatsAppPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  return <WhatsAppClient tenantId={tenantSlug} />;
}
