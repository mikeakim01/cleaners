import { getPlatformStatsAction } from "@/app/actions/admin.actions";
import { AdminOverviewClient } from "./Client";

export default async function AdminOverviewPage() {
  let initial = null;
  let initialError: string | null = null;
  try {
    const res = await getPlatformStatsAction();
    if (res.ok) initial = res.data;
    else initialError = res.error;
  } catch (err) {
    initialError = err instanceof Error ? err.message : "Error";
  }
  return <AdminOverviewClient initial={initial} initialError={initialError} />;
}
