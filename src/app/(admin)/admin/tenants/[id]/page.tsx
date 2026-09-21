import { getTenantDetailAction } from "@/app/actions/admin.actions";
import { mapTenantDetail } from "@/lib/admin-mappers";
import { TenantDetailClient } from "./Client";

export default async function AdminTenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let initial = null;
  let initialError: string | null = null;
  try {
    const res = await getTenantDetailAction(id);
    if (res.ok) initial = mapTenantDetail(res.data);
    else initialError = res.error;
  } catch (err) {
    initialError = err instanceof Error ? err.message : "Error";
  }
  return (
    <TenantDetailClient
      tenantId={id}
      initial={initial}
      initialError={initialError}
    />
  );
}
