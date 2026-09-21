import type { Metadata } from "next";
import { JobsClient } from "./JobsClient";

export const metadata: Metadata = { title: "Jobs" };

export default async function JobsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  return <JobsClient tenantSlug={tenantSlug} />;
}
