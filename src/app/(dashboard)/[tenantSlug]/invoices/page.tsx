import type { InvoiceListData } from "@/lib/tracki-types";
import { toInvoiceListData } from "@/lib/finance-mappers";
import { listInvoicesAction } from "@/app/actions/invoices.actions";
import { InvoicesClient } from "./Client";

export default async function InvoicesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  let initial: InvoiceListData | null = null;
  try {
    const res = await listInvoicesAction(tenantSlug, {});
    if (res.ok) initial = toInvoiceListData(res.data);
  } catch {
    initial = null;
  }
  return <InvoicesClient tenantId={tenantSlug} initial={initial} />;
}
