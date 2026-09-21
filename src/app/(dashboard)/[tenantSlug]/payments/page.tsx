import type { PaymentListData } from "@/lib/tracki-types";
import { toPaymentListData } from "@/lib/finance-mappers";
import { listTenantPaymentsAction } from "@/app/actions/payments.actions";
import { PaymentsClient } from "./Client";

export default async function PaymentsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  let initial: PaymentListData | null = null;
  try {
    const res = await listTenantPaymentsAction(tenantSlug, {});
    if (res.ok) initial = toPaymentListData(res.data);
  } catch {
    initial = null;
  }
  return <PaymentsClient tenantId={tenantSlug} initial={initial} />;
}
