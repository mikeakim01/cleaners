import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getTenantBySlug } from "@/services/tenants.service";
import { t } from "@/i18n";
import { SignOutButton } from "./SignOutButton";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let tenantName = tenantSlug;
  let role = "";
  try {
    const res = await getTenantBySlug(user.id, tenantSlug);
    tenantName = res.tenant.name;
    role = res.role;
  } catch {
    // Layout already gates access; profile degrades to account info.
  }

  const initial = (user.email ?? "C").slice(0, 1).toUpperCase();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-xl font-bold text-ink">
        {t("cleaner.profileTitle")}
      </h1>
      <div className="flex items-center gap-3 rounded-card border border-border bg-surface p-4">
        <span
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-full bg-primary text-lg font-bold text-white"
        >
          {initial}
        </span>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-ink">
            {user.email ?? t("cleaner.profileTitle")}
          </p>
          <p className="truncate text-sm capitalize text-muted">
            {role ? role.toLowerCase() : ""} · {tenantName}
          </p>
        </div>
      </div>
      <SignOutButton />
    </div>
  );
}
