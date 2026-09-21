export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-zinc-50 px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-zinc-100 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-lg font-bold text-[#0d7a5f]">Safi</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-zinc-600">{subtitle}</p>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p role="alert" className="mt-1 text-sm text-red-600">{message}</p>;
}

export function FormBanner({ tone, message }: { tone: "error" | "info"; message?: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={tone === "error" ? "mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" : "mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800"}
    >
      {message}
    </div>
  );
}
