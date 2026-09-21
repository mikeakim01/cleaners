import { notFound } from "next/navigation";
import { ErrorState } from "@/components/ui";
import { t } from "@/i18n";
import { getPublicTenantAction } from "@/app/actions/public.actions";
import { mapPublicTenant } from "@/lib/portal-mappers";
import { BookWizardClient } from "./Client";

export default async function PublicBookPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ name?: string; phone?: string; service?: string }>;
}) {
  const { tenantSlug } = await params;
  const prefill = await searchParams;
  const res = await getPublicTenantAction(tenantSlug);
  if (!res.ok) notFound();
  const { tenant, branches, services } = mapPublicTenant(res.data);
  if (services.length === 0) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <ErrorState message={t("common.errorNoData")} />
      </div>
    );
  }
  return (
    <BookWizardClient
      slug={tenant.slug}
      brand={tenant.primaryColor || "#0d7a5f"}
      name={tenant.name}
      services={services}
      branches={branches}
      prefill={{
        name: prefill.name ?? "",
        phone: prefill.phone ?? "",
        service: prefill.service ?? "",
      }}
    />
  );
}
