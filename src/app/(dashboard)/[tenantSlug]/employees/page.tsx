import type { Employee } from "@/lib/trackf-types";
import { listEmployeesAction } from "@/app/actions/employees.actions";
import { mapServiceEmployee } from "@/hooks/useEmployees";
import { EmployeesClient } from "./Client";

export default async function EmployeesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  let initial: Employee[] = [];
  try {
    const res = await listEmployeesAction(tenantSlug, {});
    if (res.ok) initial = res.data.map(mapServiceEmployee);
  } catch {
    initial = [];
  }
  return <EmployeesClient tenantId={tenantSlug} initial={initial} />;
}
