import type { Metadata } from "next";
import { EarningsClient } from "./EarningsClient";

export const metadata: Metadata = { title: "Earnings" };

export default async function EarningsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  return <EarningsClient tenantSlug={tenantSlug} />;
}
