import { notFound, redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getTenantBySlug } from "@/services/tenants.service";
import { TrialBannerLoader } from "@/components/domain/TrialBannerLoader";

const NAV = [
  "Dashboard", "Bookings", "Calendar", "Jobs", "Customers", "Services",
  "Quotes", "Invoices", "Payments", "WhatsApp", "Employees", "Reviews", "Reports", "Settings",
];

export default async function TenantLayout({
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

  let tenant = null;
  try {
    const res = await getTenantBySlug(user.id, tenantSlug);
    tenant = res.tenant;
  } catch {
    notFound();
  }
  if (!tenant) notFound();

  const brand = (tenant as { primary_color?: string }).primary_color || "#0d7a5f";

  return (
    <div style={{ ["--brand" as string]: brand }} className="flex min-h-full flex-col bg-zinc-50">
      {/* Topbar */}
      <header className="sticky top-0 z-10 border-b border-zinc-100 bg-white">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
          <span className="font-bold" style={{ color: "var(--brand)" }}>{tenant.name}</span>
          <input
            type="search"
            placeholder="Search bookings, customers…"
            aria-label="Search"
            className="hidden min-w-0 flex-1 rounded-full border border-zinc-200 px-4 py-1.5 text-sm outline-none focus:border-[var(--brand)] sm:block"
          />
          <span className="ml-auto hidden rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 md:block">Main branch</span>
          <button aria-label="Notifications" className="rounded-full p-2 hover:bg-zinc-100">🔔</button>
          <span aria-label="Account" className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--brand)] text-sm font-bold text-white">
            {(tenant.name || "S").slice(0, 1).toUpperCase()}
          </span>
        </div>
      </header>
      <TrialBannerLoader
        tenantId={(tenant as { id: string }).id}
        tenantSlug={tenant.slug}
      />

      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-0 sm:gap-6 sm:px-4 sm:py-6">
        {/* Sidebar */}
        <aside className="hidden w-52 shrink-0 sm:block">
          <nav className="flex flex-col gap-1 rounded-2xl border border-zinc-100 bg-white p-3">
            {NAV.map((item) => {
              const href = item === "Dashboard" ? "dashboard" : item.toLowerCase();
              const active = item === "Dashboard";
              return (
                <a
                  key={item}
                  href={`/${tenant.slug}/${href}`}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-xl px-3 py-2 text-sm font-medium ${active ? "bg-emerald-50 text-emerald-900" : "text-zinc-600 hover:bg-zinc-50"}`}
                >
                  {item}
                </a>
              );
            })}
          </nav>
        </aside>

        {/* Mobile nav */}
        <nav aria-label="Sections" className="flex gap-2 overflow-x-auto border-b border-zinc-100 bg-white px-4 py-2 sm:hidden">
          {NAV.map((item) => (
            <a key={item} href={`/${tenant.slug}/${item === "Dashboard" ? "dashboard" : item.toLowerCase()}`}
              className="whitespace-nowrap rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700">
              {item}
            </a>
          ))}
        </nav>

        <main id="main-content" className="min-w-0 flex-1 px-4 py-4 sm:px-0 sm:py-0">{children}</main>
      </div>
    </div>
  );
}
