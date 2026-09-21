import type { FinancialSummary } from "@/lib/tracki-types";
import { mapFinancialSummary } from "@/lib/finance-mappers";
import { getFinancialSummaryAction } from "@/app/actions/reports.actions";
import { ReportsClient } from "./Client";

export default async function ReportsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  let initial: FinancialSummary | null = null;
  try {
    const res = await getFinancialSummaryAction(tenantSlug, {});
    if (res.ok) initial = mapFinancialSummary(res.data);
  } catch {
    initial = null;
  }
  return <ReportsClient tenantId={tenantSlug} initial={initial} />;
}
