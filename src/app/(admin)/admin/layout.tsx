import { ErrorState } from "@/components/ui";
import { t } from "@/i18n";
import { getPlatformStatsAction } from "@/app/actions/admin.actions";

const NAV = [
  { label: "Overview", href: "/admin" },
  { label: "Tenants", href: "/admin/tenants" },
  { label: "Plans", href: "/admin/plans" },
  { label: "Audit", href: "/admin/audit" },
];

/**
 * Platform shell. Guard: the sibling `getPlatformStatsAction` is assumed to
 * enforce super-admin access (requireSuperAdmin inside admin.actions) and so
 * returns ok:false for everyone else — this layout renders an honest
 * "access required" error instead of the admin UI in that case.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let allowed = false;
  try {
    const res = await getPlatformStatsAction();
    allowed = res.ok;
  } catch {
    allowed = false;
  }

  return (
    <div className="flex min-h-full flex-col bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-full bg-amber-400 text-sm font-bold text-zinc-950"
          >
            S
          </span>
          <span className="font-bold tracking-tight">
            {t("admin.platformName")}
          </span>
          <nav aria-label="Platform" className="ml-4 hidden gap-1 sm:flex">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-full px-3 py-1.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
        <nav
          aria-label="Platform"
          className="flex gap-2 overflow-x-auto px-4 pb-2 sm:hidden"
        >
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-full bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </header>

      <div className="bg-zinc-100 text-zinc-900">
        <main className="mx-auto w-full max-w-6xl px-4 py-4 sm:py-6">
          {allowed ? (
            children
          ) : (
            <ErrorState message={t("admin.accessRequired")} />
          )}
        </main>
      </div>
    </div>
  );
}
