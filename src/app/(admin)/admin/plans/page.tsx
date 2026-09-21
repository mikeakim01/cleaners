import { listPlansAction } from "@/app/actions/admin.actions";
import { mapPlans } from "@/lib/admin-mappers";
import { PlansClient } from "./Client";

export default async function AdminPlansPage() {
  let initial = null;
  let initialError: string | null = null;
  try {
    const res = await listPlansAction();
    if (res.ok) initial = mapPlans(res.data);
    else initialError = res.error;
  } catch (err) {
    initialError = err instanceof Error ? err.message : "Error";
  }
  return <PlansClient initial={initial} initialError={initialError} />;
}
