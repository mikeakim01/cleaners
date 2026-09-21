import type { Metadata } from "next";
import { ScheduleClient } from "./ScheduleClient";

export const metadata: Metadata = { title: "Schedule" };

export default async function SchedulePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  return <ScheduleClient tenantSlug={tenantSlug} />;
}
