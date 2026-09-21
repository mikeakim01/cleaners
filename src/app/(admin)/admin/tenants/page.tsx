import { listAllTenantsAction } from "@/app/actions/admin.actions";
import { mapTenantRows } from "@/lib/admin-mappers";
import { TenantsClient } from "./Client";

export default async function AdminTenantsPage() {
  let initial = null;
  let initialError: string | null = null;
  try {
    const res = await listAllTenantsAction({});
    if (res.ok) initial = mapTenantRows(res.data);
    else initialError = res.error;
  } catch (err) {
    initialError = err instanceof Error ? err.message : "Error";
  }
  return <TenantsClient initial={initial} initialError={initialError} />;
}
