import type { Customer } from "@/lib/trackf-types";
import { listCustomersAction } from "@/app/actions/customers.actions";
import { mapServiceCustomer } from "@/hooks/useCustomers";
import { CustomersClient } from "./Client";

export default async function CustomersPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  let initial: Customer[] = [];
  try {
    const res = await listCustomersAction(tenantSlug, {});
    if (res.ok) initial = res.data.map(mapServiceCustomer);
  } catch {
    initial = [];
  }
  return <CustomersClient tenantId={tenantSlug} initial={initial} />;
}
