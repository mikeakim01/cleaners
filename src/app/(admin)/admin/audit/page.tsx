import { listPlatformAuditAction } from "@/app/actions/admin.actions";
import { mapAuditRows } from "@/lib/admin-mappers";
import { AuditClient } from "./Client";

export default async function AdminAuditPage() {
  let initial = null;
  let initialError: string | null = null;
  try {
    const res = await listPlatformAuditAction();
    if (res.ok) initial = mapAuditRows(res.data);
    else initialError = res.error;
  } catch (err) {
    initialError = err instanceof Error ? err.message : "Error";
  }
  return <AuditClient initial={initial} initialError={initialError} />;
}
