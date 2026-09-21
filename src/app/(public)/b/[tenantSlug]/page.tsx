import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarCheck, Clock, MapPin, Phone, ShieldCheck, Sparkles, Star } from "lucide-react";
import { Button, Currency, EmptyState } from "@/components/ui";
import { formatPhone255 } from "@/lib/format";
import { t } from "@/i18n";
import { getPublicTenantAction } from "@/app/actions/public.actions";
import { mapPublicTenant } from "@/lib/portal-mappers";

function Stars({ value }: { value: number }) {
  return (
    <span aria-label={`${value} / 5`} className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          size={18}
          aria-hidden="true"
          className={s <= Math.round(value) ? "fill-amber-400 text-amber-400" : "text-zinc-300"}
        />
      ))}
    </span>
  );
}

export default async function PublicBusinessPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const res = await getPublicTenantAction(tenantSlug);
  if (!res.ok) notFound();
  const { tenant, branches, services, reviewsSummary, reviews } = mapPublicTenant(res.data);
  const brand = tenant.primaryColor || "#0d7a5f";

  return (
    <div
      style={{ ["--brand" as string]: brand }}
      className="min-h-full bg-zinc-50 pb-16"
    >
      {/* Branded header */}
      <header className="border-b border-zinc-100 bg-white">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center gap-3 px-4">
          {tenant.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tenant.logoUrl} alt={tenant.name} className="h-9 w-9 rounded-full object-cover" />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-full text-base font-bold text-white"
              style={{ background: "var(--brand)" }}
            >
              {tenant.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="text-base font-bold text-zinc-900">{tenant.name}</span>
          <a
            href={`tel:${tenant.phoneE164}`}
            className="ml-auto inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white"
            style={{ background: "var(--brand)" }}
          >
            <Phone size={18} aria-hidden="true" />
            {t("public.callNow")}
          </a>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 pt-8">
        {/* Hero */}
        <section className="rounded-3xl bg-white p-6 text-center shadow-sm sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">{tenant.name}</p>
          <h1 className="mx-auto mt-2 max-w-xl text-2xl font-bold text-zinc-900 sm:text-4xl">
            {t("public.heroTitle")}
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-sm text-zinc-600 sm:text-base">
            {t("public.heroSubtitle")}
          </p>
          <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
            <Link
              href={`/b/${tenant.slug}/book`}
              className="inline-flex h-12 items-center gap-2 rounded-full px-6 text-base font-semibold text-white"
              style={{ background: "var(--brand)" }}
            >
              <CalendarCheck size={18} aria-hidden="true" />
              {t("public.book")}
            </Link>
            {reviewsSummary.count > 0 ? (
              <span className="inline-flex items-center gap-2 text-sm text-zinc-600">
                <Stars value={reviewsSummary.avg} />
                {reviewsSummary.avg.toFixed(1)} · {reviewsSummary.count} {t("public.basedOn")}
              </span>
            ) : null}
          </div>
        </section>

        {/* Services */}
        <section aria-labelledby="services-heading">
          <h2 id="services-heading" className="text-lg font-bold text-zinc-900">
            {t("public.servicesTitle")}
          </h2>
          {services.length === 0 ? (
            <div className="mt-3">
              <EmptyState title={t("common.empty")} />
            </div>
          ) : (
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {services.map((s) => (
                <li key={s.id} className="flex flex-col gap-2 rounded-2xl border border-zinc-100 bg-white p-5">
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white"
                      style={{ background: "var(--brand)" }}
                    >
                      <Sparkles size={18} />
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-zinc-900">{s.name}</p>
                      <p className="mt-0.5 line-clamp-2 text-sm text-zinc-600">{s.description}</p>
                    </div>
                  </div>
                  <div className="mt-auto flex items-center justify-between pt-2">
                    <p className="text-sm text-zinc-600">
                      {t("public.fromPrice")} <Currency amountMinor={s.baseMinor} />
                    </p>
                    <Link
                      href={`/b/${tenant.slug}/book?service=${encodeURIComponent(s.id)}`}
                      className="inline-flex h-9 items-center rounded-full px-4 text-sm font-semibold text-white"
                      style={{ background: "var(--brand)" }}
                    >
                      {t("public.book")}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-zinc-500">* {t("public.finalPriceNote")}</p>
        </section>

        {/* How it works */}
        <section aria-labelledby="how-heading" className="rounded-3xl bg-white p-6 sm:p-8">
          <h2 id="how-heading" className="text-lg font-bold text-zinc-900">{t("public.howItWorks")}</h2>
          <ol className="mt-4 grid gap-4 sm:grid-cols-3">
            {[
              { n: "1", title: t("public.step1"), body: t("public.step1Body") },
              { n: "2", title: t("public.step2"), body: t("public.step2Body") },
              { n: "3", title: t("public.step3"), body: t("public.step3Body") },
            ].map((s) => (
              <li key={s.n} className="rounded-2xl bg-zinc-50 p-4">
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ background: "var(--brand)" }}
                >
                  {s.n}
                </span>
                <p className="mt-2 font-semibold text-zinc-900">{s.title}</p>
                <p className="mt-1 text-sm text-zinc-600">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Reviews */}
        {reviews.length > 0 ? (
          <section aria-labelledby="reviews-heading">
            <h2 id="reviews-heading" className="text-lg font-bold text-zinc-900">
              {t("public.reviewsTitle")}
            </h2>
            <div className="mt-3 flex items-center gap-2">
              <Stars value={reviewsSummary.avg} />
              <span className="text-sm font-semibold text-zinc-900">{reviewsSummary.avg.toFixed(1)}</span>
              <span className="text-sm text-zinc-500">
                · {reviewsSummary.count} {t("public.basedOn")}
              </span>
            </div>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {reviews.slice(0, 4).map((r, i) => (
                <li key={i} className="rounded-2xl border border-zinc-100 bg-white p-5">
                  <Stars value={r.rating} />
                  <p className="mt-2 text-sm text-zinc-700">“{r.comment}”</p>
                  <p className="mt-2 text-xs font-medium text-zinc-500">— {r.customerName}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Quick booking */}
        <section aria-labelledby="quick-heading" className="rounded-3xl bg-white p-6 sm:p-8">
          <h2 id="quick-heading" className="text-lg font-bold text-zinc-900">{t("public.quickBook")}</h2>
          <form
            method="get"
            action={`/b/${tenant.slug}/book`}
            className="mt-4 grid gap-3 sm:grid-cols-4 sm:items-end"
          >
            <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-900">
              {t("public.nameLabel")}
              <input
                name="name"
                autoComplete="name"
                className="h-11 rounded-xl border border-zinc-200 px-3.5 text-[15px] font-normal outline-none focus:border-[var(--brand)]"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-900">
              {t("public.phoneLabel")}
              <input
                name="phone"
                inputMode="tel"
                autoComplete="tel"
                className="h-11 rounded-xl border border-zinc-200 px-3.5 text-[15px] font-normal outline-none focus:border-[var(--brand)]"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-900">
              {t("public.serviceLabel")}
              <select
                name="service"
                className="h-11 rounded-xl border border-zinc-200 bg-white px-3.5 text-[15px] font-normal outline-none focus:border-[var(--brand)]"
              >
                <option value="">—</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" className="sm:w-auto" style={{ background: "var(--brand)" }}>
              {t("public.continue")}
            </Button>
          </form>
        </section>

        {/* FAQ */}
        <section aria-labelledby="faq-heading" className="rounded-3xl bg-white p-6 sm:p-8">
          <h2 id="faq-heading" className="text-lg font-bold text-zinc-900">{t("public.faqTitle")}</h2>
          <div className="mt-3 divide-y divide-zinc-100">
            {[
              { q: t("public.faq1Q"), a: t("public.faq1A") },
              { q: t("public.faq2Q"), a: t("public.faq2A") },
              { q: t("public.faq3Q"), a: t("public.faq3A") },
            ].map((f) => (
              <details key={f.q} className="group py-3">
                <summary className="cursor-pointer list-none text-sm font-semibold text-zinc-900">
                  {f.q}
                </summary>
                <p className="mt-1 text-sm text-zinc-600">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="mx-auto mt-10 w-full max-w-5xl px-4 text-sm text-zinc-600">
        <div className="flex flex-col gap-2 rounded-3xl bg-white p-6 sm:flex-row sm:items-center sm:gap-8">
          <span className="inline-flex items-center gap-2">
            <MapPin size={18} aria-hidden="true" />
            {t("public.addressLabel")}: {tenant.address || branches[0]?.address || "Dar es Salaam"}
          </span>
          <span className="inline-flex items-center gap-2">
            <Clock size={18} aria-hidden="true" />
            {t("public.hoursLabel")}: {tenant.hours || branches[0]?.hours || "Mon–Sat"}
          </span>
          <a href={`tel:${tenant.phoneE164}`} className="inline-flex items-center gap-2 font-semibold sm:ml-auto" style={{ color: "var(--brand)" }}>
            <ShieldCheck size={18} aria-hidden="true" />
            {formatPhone255(tenant.phoneE164)}
          </a>
        </div>
      </footer>
    </div>
  );
}
