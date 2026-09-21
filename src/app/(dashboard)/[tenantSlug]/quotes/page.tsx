import type { Quote } from "@/lib/trackf-types";
import { listQuotesAction } from "@/app/actions/quotes.actions";
import { mapServiceQuote } from "@/hooks/useQuotes";
import { QuotesClient } from "./Client";

export default async function QuotesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  let initial: Quote[] = [];
  try {
    const res = await listQuotesAction(tenantSlug, {});
    if (res.ok) initial = res.data.map(mapServiceQuote);
  } catch {
    initial = [];
  }
  return <QuotesClient tenantId={tenantSlug} initial={initial} />;
}
