import type { Job, Paged } from "@/lib/trackf-types";
import { listJobsAction } from "@/app/actions/jobs.actions";
import { mapServiceJob } from "@/hooks/useJobs";
import { JobsClient } from "./Client";

export default async function JobsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  let initial: Paged<Job> = { rows: [], total: 0, page: 1, pageSize: 20 };
  try {
    const res = await listJobsAction(tenantSlug, {});
    if (res.ok) {
      const rows = res.data.map(mapServiceJob);
      initial = { rows, total: rows.length, page: 1, pageSize: 20 };
    }
  } catch {
    initial = { rows: [], total: 0, page: 1, pageSize: 20 };
  }
  return <JobsClient tenantId={tenantSlug} initial={initial} />;
}
