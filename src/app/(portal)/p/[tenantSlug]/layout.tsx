import { getPublicTenantAction } from "@/app/actions/public.actions";

export default async function PortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  let brand = "#0d7a5f";
  let name = tenantSlug;
  try {
    const res = await getPublicTenantAction(tenantSlug);
    if (res.ok) {
      brand = res.data.primary_color || brand;
      name = res.data.name || name;
    }
  } catch {
    // fall back to defaults — portal still renders login/error states
  }
  return (
    <div style={{ ["--brand" as string]: brand }} className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-100 bg-white">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center px-4">
          <span className="text-sm font-bold" style={{ color: "var(--brand)" }}>
            {name}
          </span>
          <span className="ml-2 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600">
            Customer portal
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 py-6">{children}</main>
    </div>
  );
}
