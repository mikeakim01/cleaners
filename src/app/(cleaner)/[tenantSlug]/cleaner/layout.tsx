import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getTenantBySlug } from "@/services/tenants.service";
import { isCleanerRole } from "@/lib/cleaner-types";
import { t } from "@/i18n";
import { ConnectionBanner } from "@/components/cleaner/ConnectionBanner";
import { CleanerTabs } from "@/components/cleaner/CleanerTabs";

export const metadata: Metadata = {
  title: "Cleaner",
  manifest: "/manifest.json",
  themeColor: "#0F766E",
};

export default async function CleanerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let tenant: { id: string; name: string; slug: string } | null = null;
  let role = "";
  try {
    const res = await getTenantBySlug(user.id, tenantSlug);
    tenant = res.tenant;
    role = res.role;
  } catch {
    tenant = null;
  }

  if (!tenant) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-3 px-4 py-10">
        <p role="alert" className="text-sm text-ink">
          {t("cleaner.notAssigned")}
        </p>
      </div>
    );
  }

  if (!isCleanerRole(role)) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-3 px-4 py-10">
        <p role="alert" className="text-sm text-ink">
          {t("cleaner.notAssigned")}
        </p>
        <p className="text-sm text-muted">
          {t("cleaner.roleLabel")}: {role}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 w-full max-w-md items-center gap-2 px-4">
          <span className="truncate text-base font-bold text-primary">
            {tenant.name}
          </span>
          <span className="ml-auto rounded-full bg-canvas px-2.5 py-1 text-xs font-medium capitalize text-muted">
            {role.toLowerCase()}
          </span>
        </div>
      </header>
      <div className="mx-auto w-full max-w-md px-4 pt-3">
        <ConnectionBanner tenantSlug={tenant.slug} />
      </div>
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-4">
        {children}
      </main>
      <CleanerTabs tenantSlug={tenant.slug} />
    </div>
  );
}
