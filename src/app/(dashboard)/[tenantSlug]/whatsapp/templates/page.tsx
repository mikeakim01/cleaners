import { TemplatesClient } from "./Client";

export default async function WhatsAppTemplatesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  return <TemplatesClient tenantId={tenantSlug} />;
}
