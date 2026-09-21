"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, Minus, Plus } from "lucide-react";
import { Button, Currency, ErrorState, Input, LoadingState, Select } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { t } from "@/i18n";
import { createPublicBookingAction } from "@/app/actions/public.actions";
import type {
  PublicBranch,
  PublicService,
} from "@/lib/portal-mappers";

const PROPERTY_TYPES = ["House", "Apartment", "Office", "Other"] as const;
const SLOTS = ["morning", "midday", "afternoon", "evening"] as const;

interface Draft {
  serviceId: string;
  addonIds: string[];
  propertyType: string;
  bedrooms: number;
  bathrooms: number;
  livingRooms: number;
  areaSqm: string;
  floor: string;
  instructions: string;
  ward: string;
  date: string;
  slot: string;
  name: string;
  phone: string;
  address: string;
  branchId: string;
}

const EMPTY: Draft = {
  serviceId: "",
  addonIds: [],
  propertyType: "House",
  bedrooms: 2,
  bathrooms: 1,
  livingRooms: 1,
  areaSqm: "",
  floor: "",
  instructions: "",
  ward: "",
  date: "",
  slot: "",
  name: "",
  phone: "",
  address: "",
  branchId: "",
};

function Stepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-2">
      <span className="text-sm font-medium">{label}</span>
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          onClick={() => onChange(Math.max(0, value - 1))}
          className="rounded-full border border-zinc-200 p-1.5 hover:bg-zinc-50"
        >
          <Minus size={18} aria-hidden="true" />
        </button>
        <span aria-live="polite" className="w-6 text-center text-sm font-bold tabular-nums">
          {value}
        </span>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          onClick={() => onChange(Math.min(20, value + 1))}
          className="rounded-full border border-zinc-200 p-1.5 hover:bg-zinc-50"
        >
          <Plus size={18} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

export function BookWizardClient({
  slug,
  brand,
  name,
  services,
  branches,
  prefill,
}: {
  slug: string;
  brand: string;
  name: string;
  services: PublicService[];
  branches: PublicBranch[];
  prefill: { name: string; phone: string; service: string };
}) {
  const draftKey = `public-booking-draft-${slug}`;
  const [step, setStep] = useState(1);
  // Prefill from query + autosaved draft via lazy initializer (no effect needed).
  const [draft, setDraft] = useState<Draft>(() => {    try {
      const raw =
        typeof localStorage === "undefined" ? null : localStorage.getItem(draftKey);
      const saved = raw ? (JSON.parse(raw) as Partial<Draft>) : {};
      return {
        ...EMPTY,
        ...saved,
        serviceId: (saved.serviceId || prefill.service) ?? "",
        name: saved.name || prefill.name,
        phone: saved.phone || prefill.phone,
      };
    } catch {
      return { ...EMPTY, serviceId: prefill.service, name: prefill.name, phone: prefill.phone };
    }
  });
  // Mount gate: avoids SSR/client hydration mismatch for the localStorage draft.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ reference: string; estimateMinor: number } | null>(null);

  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      // ignore quota errors
    }
  }, [draft, draftKey, mounted]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const selected = services.find((s) => s.id === draft.serviceId) ?? null;
  const addons = services.filter((s) => draft.addonIds.includes(s.id));
  const estimateMinor = useMemo(
    () => (selected ? selected.baseMinor + addons.reduce((a, s) => a + s.baseMinor, 0) : 0),
    [selected, addons],
  );

  const todayIso = new Date().toISOString().slice(0, 10);

  function validate(s: number): string | null {
    if (s === 1 && !draft.serviceId) return "Please choose a service to continue.";
    if (s === 4 && !draft.date) return "Please pick a day for your clean.";
    if (s === 4 && draft.date < todayIso) return "Please pick a day in the future.";
    if (s === 4 && !draft.slot) return "Please choose an arrival window.";
    if (s === 5 && draft.name.trim().length < 2) return "Please tell us your name.";
    if (s === 5 && draft.phone.replace(/\D/g, "").length < 9)
      return "Please enter a valid phone number so the crew can reach you.";
    if (s === 5 && !draft.address.trim()) return "Please enter the cleaning address.";
    return null;
  }

  function next() {
    const msg = validate(step);
    setFieldError(msg);
    if (msg) return;
    setFieldError(null);
    setStep((s) => Math.min(7, s + 1));
    window.scrollTo({ top: 0 });
  }

  function back() {
    setFieldError(null);
    setStep((s) => Math.max(1, s - 1));
    window.scrollTo({ top: 0 });
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    const res = await createPublicBookingAction(slug, {
      serviceId: draft.serviceId,
      addOnServiceIds: draft.addonIds,
      propertyType: draft.propertyType.toLowerCase(),
      bedrooms: draft.bedrooms,
      bathrooms: draft.bathrooms,
      livingRooms: draft.livingRooms,
      areaSqm: draft.areaSqm ? Number(draft.areaSqm) : 0,
      floorLevel: draft.floor,
      accessInstructions: draft.instructions,
      ward: draft.ward,
      scheduledDate: draft.date,
      timeSlot: draft.slot,
      fullName: draft.name.trim(),
      phone: draft.phone.trim(),
      address: draft.address.trim(),
      branchId: draft.branchId || undefined,
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setResult({ reference: res.data.reference, estimateMinor: res.data.estimateMinor });
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
    setStep(8);
    window.scrollTo({ top: 0 });
  }

  if (!mounted) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <LoadingState label={t("common.loading")} />
      </div>
    );
  }

  const done = step === 8 && result;

  return (
    <div style={{ ["--brand" as string]: brand }} className="min-h-full bg-zinc-50 pb-16">
      <header className="border-b border-zinc-100 bg-white">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center gap-3 px-4">
          <Link href={`/b/${slug}`} aria-label="Back to business page" className="rounded-full p-2 hover:bg-zinc-100">
            <ArrowLeft size={18} aria-hidden="true" />
          </Link>
          <span className="text-sm font-bold">{name}</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 pt-6">
        {/* Progress */}
        <div aria-label={done ? "Done" : `Step ${step} of 7`} className="mb-4">
          <p className="text-xs font-semibold text-zinc-500">
            {done ? "Done" : `Step ${step} of 7`}
          </p>
          <div role="progressbar" aria-valuenow={done ? 8 : step} aria-valuemin={1} aria-valuemax={8} className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-200">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${((done ? 8 : step) / 8) * 100}%`, background: "var(--brand)" }}
            />
          </div>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm sm:p-7">
          {step === 1 ? (
            <section aria-labelledby="s1">
              <h1 id="s1" className="text-lg font-bold">Choose a service</h1>
              <ul className="mt-3 grid gap-2">
                {services.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      aria-pressed={draft.serviceId === s.id}
                      onClick={() => set("serviceId", s.id)}
                      className={`w-full rounded-2xl border p-4 text-left ${draft.serviceId === s.id ? "border-[var(--brand)] bg-emerald-50/40" : "border-zinc-200 hover:border-zinc-300"}`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{s.name}</span>
                        <Currency amountMinor={s.baseMinor} />
                      </span>
                      <span className="mt-1 block text-sm text-zinc-600">{s.description}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {selected ? (
                <div className="mt-4">
                  <p className="text-sm font-semibold">Add-ons (optional)</p>
                  <ul className="mt-2 grid gap-2">
                    {services
                      .filter((s) => s.id !== selected.id)
                      .map((s) => {
                        const on = draft.addonIds.includes(s.id);
                        return (
                          <li key={s.id}>
                            <button
                              type="button"
                              aria-pressed={on}
                              onClick={() =>
                                set(
                                  "addonIds",
                                  on ? draft.addonIds.filter((a) => a !== s.id) : [...draft.addonIds, s.id],
                                )
                              }
                              className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm ${on ? "border-[var(--brand)] bg-emerald-50/40 font-semibold" : "border-zinc-200"}`}
                            >
                              <span>{s.name}</span>
                              <span className="tabular-nums text-zinc-600">+{formatMoney(s.baseMinor)}</span>
                            </button>
                          </li>
                        );
                      })}
                  </ul>
                  <p className="mt-3 text-sm">
                    Estimate: <Currency amountMinor={estimateMinor} />{" "}
                    <span className="text-xs text-zinc-500">· {t("public.finalPriceNote")}</span>
                  </p>
                </div>
              ) : null}
            </section>
          ) : null}

          {step === 2 ? (
            <section aria-labelledby="s2">
              <h1 id="s2" className="text-lg font-bold">About your place</h1>
              <div role="radiogroup" aria-label="Property type" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PROPERTY_TYPES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={draft.propertyType === p}
                    onClick={() => set("propertyType", p)}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-medium ${draft.propertyType === p ? "border-[var(--brand)] bg-emerald-50/40" : "border-zinc-200"}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <div className="mt-3 grid gap-2">
                <Stepper label="Bedrooms" value={draft.bedrooms} onChange={(v) => set("bedrooms", v)} />
                <Stepper label="Bathrooms" value={draft.bathrooms} onChange={(v) => set("bathrooms", v)} />
                <Stepper label="Living rooms" value={draft.livingRooms} onChange={(v) => set("livingRooms", v)} />
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Input label="Area (sqm, optional)" inputMode="numeric" value={draft.areaSqm} onChange={(e) => set("areaSqm", e.target.value)} />
                <Input label="Floor (optional)" placeholder="e.g. 2nd floor" value={draft.floor} onChange={(e) => set("floor", e.target.value)} />
              </div>
            </section>
          ) : null}

          {step === 3 ? (
            <section aria-labelledby="s3">
              <h1 id="s3" className="text-lg font-bold">Access details</h1>
              <div className="mt-3 grid gap-3">
                <Input label="Ward" placeholder="e.g. Masaki" value={draft.ward} onChange={(e) => set("ward", e.target.value)} />
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Access instructions
                  <textarea
                    value={draft.instructions}
                    onChange={(e) => set("instructions", e.target.value)}
                    rows={4}
                    placeholder="Gate code, parking, pets, anything the crew should know…"
                    className="w-full rounded-xl border border-zinc-200 px-3.5 py-2.5 text-[15px] font-normal outline-none focus:border-[var(--brand)]"
                  />
                </label>
              </div>
            </section>
          ) : null}

          {step === 4 ? (
            <section aria-labelledby="s4">
              <h1 id="s4" className="text-lg font-bold">Pick a day & time</h1>
              <div className="mt-3 grid gap-3">
                <Input label="Date" type="date" min={todayIso} value={draft.date} onChange={(e) => set("date", e.target.value)} />
                <div role="radiogroup" aria-label="Arrival window" className="grid grid-cols-2 gap-2">
                  {SLOTS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={draft.slot === s}
                      onClick={() => set("slot", s)}
                      className={`rounded-xl border px-3 py-2.5 text-sm font-medium capitalize ${draft.slot === s ? "border-[var(--brand)] bg-emerald-50/40" : "border-zinc-200"}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          {step === 5 ? (
            <section aria-labelledby="s5">
              <h1 id="s5" className="text-lg font-bold">Your details</h1>
              <div className="mt-3 grid gap-3">
                <Input label={t("public.nameLabel")} autoComplete="name" value={draft.name} onChange={(e) => set("name", e.target.value)} />
                <Input label={t("public.phoneLabel")} inputMode="tel" autoComplete="tel" value={draft.phone} onChange={(e) => set("phone", e.target.value)} />
                <Input label="Cleaning address" autoComplete="street-address" value={draft.address} onChange={(e) => set("address", e.target.value)} />
                {branches.length > 0 ? (
                  <Select
                    label="Branch"
                    placeholder="Nearest branch"
                    options={branches.map((b) => ({ value: b.id, label: b.name }))}
                    value={draft.branchId}
                    onChange={(e) => set("branchId", e.target.value)}
                  />
                ) : null}
              </div>
            </section>
          ) : null}

          {step === 6 ? (
            <section aria-labelledby="s6">
              <h1 id="s6" className="text-lg font-bold">Review your booking</h1>
              <dl className="mt-3 divide-y divide-zinc-100 rounded-2xl border border-zinc-100 text-sm">
                {[
                  ["Service", selected?.name ?? "—"],
                  ["Add-ons", addons.length > 0 ? addons.map((a) => a.name).join(", ") : "None"],
                  ["Place", `${draft.propertyType} · ${draft.bedrooms} bed · ${draft.bathrooms} bath`],
                  ["When", `${draft.date || "—"} · ${draft.slot || "—"}`],
                  ["Where", `${draft.address || "—"}${draft.ward ? `, ${draft.ward}` : ""}`],
                  ["Contact", `${draft.name || "—"} · ${draft.phone || "—"}`],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-4 px-4 py-2.5">
                    <dt className="text-zinc-500">{k}</dt>
                    <dd className="text-right font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-sm">
                Estimate: <Currency amountMinor={estimateMinor} />{" "}
                <span className="text-xs text-zinc-500">· {t("public.finalPriceNote")}</span>
              </p>
              {error ? (
                <div className="mt-3">
                  <ErrorState message={error} onRetry={() => setError(null)} retryLabel={t("common.retry")} />
                </div>
              ) : null}
            </section>
          ) : null}

          {step === 7 && !done ? (
            <section aria-labelledby="s7">
              <h1 id="s7" className="text-lg font-bold">Confirm & send</h1>
              <p className="mt-2 text-sm text-zinc-600">
                Sending creates booking <strong>{selected?.name}</strong> for <strong>{draft.date} · {draft.slot}</strong>.
                The crew confirms by quote — estimate <Currency amountMinor={estimateMinor} />.
              </p>
              {error ? (
                <div className="mt-3">
                  <ErrorState message={error} onRetry={() => setError(null)} retryLabel={t("common.retry")} />
                </div>
              ) : null}
              <Button onClick={submit} loading={submitting} className="mt-4 w-full" style={{ background: "var(--brand)" }}>
                Confirm booking
              </Button>
            </section>
          ) : null}

          {done && result ? (
            <section aria-labelledby="done" className="text-center">
              <CheckCircle2 size={40} aria-hidden="true" className="mx-auto text-emerald-600" />
              <h1 id="done" className="mt-2 text-lg font-bold">Booking received</h1>
              <p className="mt-1 text-sm text-zinc-600">Show this reference to the crew:</p>
              <p className="mx-auto mt-3 w-fit rounded-2xl bg-zinc-50 px-6 py-3 text-2xl font-bold tracking-widest tabular-nums">
                {result.reference}
              </p>
              <p className="mt-2 text-sm">
                Estimate: <Currency amountMinor={result.estimateMinor} />
              </p>
              <p className="mx-auto mt-3 max-w-sm text-sm text-zinc-600">
                We sent the details to your phone. Reply on WhatsApp if anything changes.
              </p>
              <Link
                href={`/b/${slug}`}
                className="mt-5 inline-flex h-11 items-center rounded-full px-6 text-sm font-semibold text-white"
                style={{ background: "var(--brand)" }}
              >
                Back to {name}
              </Link>
            </section>
          ) : null}

          {fieldError && !done ? (
            <p role="alert" className="mt-3 text-sm text-red-600">
              {fieldError}
            </p>
          ) : null}

          {!done ? (
            <div className="mt-5 flex items-center justify-between gap-2">
              <Button variant="secondary" onClick={back} disabled={step === 1 || submitting}>
                <ArrowLeft size={18} aria-hidden="true" /> {t("common.prev")}
              </Button>
              {step < 6 ? (
                <Button onClick={next} style={{ background: "var(--brand)" }}>
                  {t("common.next")} <ArrowRight size={18} aria-hidden="true" />
                </Button>
              ) : step === 6 ? (
                <Button onClick={next} style={{ background: "var(--brand)" }}>
                  Continue <ArrowRight size={18} aria-hidden="true" />
                </Button>
              ) : (
                <span className="text-xs text-zinc-500">Step 7 of 7 — confirm above</span>
              )}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
