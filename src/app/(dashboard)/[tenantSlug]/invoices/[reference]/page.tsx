import type { InvoiceDetailData } from "@/lib/tracki-types";
import { mapServiceInvoiceDetail } from "@/lib/finance-mappers";
import { getInvoiceByReferenceAction } from "@/app/actions/invoices.actions";
import { InvoiceDetailClient } from "./Client";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; reference: string }>;
}) {
  const { tenantSlug, reference } = await params;
  let initial: InvoiceDetailData | null = null;
  try {
    const res = await getInvoiceByReferenceAction(tenantSlug, reference);
    if (res.ok) initial = mapServiceInvoiceDetail(res.data);
  } catch {
    initial = null;
  }
  return (
    <InvoiceDetailClient
      tenantId={tenantSlug}
      reference={reference}
      initial={initial}
    />
  );
}
