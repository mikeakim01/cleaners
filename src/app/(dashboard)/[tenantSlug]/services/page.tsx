import type { ServiceItem } from "@/lib/trackf-types";
import { listServicesAction } from "@/app/actions/catalog.actions";
import { mapCatalogService } from "@/hooks/useCatalog";
import { ServicesClient } from "./Client";

export default async function ServicesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  let initial: ServiceItem[] = [];
  try {
    const res = await listServicesAction(tenantSlug, { activeOnly: false });
    if (res.ok) initial = res.data.map(mapCatalogService);
  } catch {
    initial = [];
  }
  return <ServicesClient tenantId={tenantSlug} initial={initial} />;
}
