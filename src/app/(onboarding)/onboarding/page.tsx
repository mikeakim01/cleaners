"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createTenantAction } from "@/app/actions/tenants.actions";
import { saveOnboardingDraftAction } from "@/app/actions/onboarding.actions";

const STEPS = [
  "Business Profile",
  "Zones & Branches",
  "Catalog",
  "Staff",
  "Hours",
  "Payments",
  "WhatsApp",
  "Templates",
  "Widget",
  "Go Live",
] as const;

const BusinessProfileSchema = z.object({
  name: z.string().trim().min(3, "Business name must be at least 3 characters."),
  slug: z.string().trim().toLowerCase().min(3, "URL handle must be at least 3 characters.").regex(/^[a-z0-9-]+$/, "Only lowercase letters, numbers and dashes."),
  phone: z.string().trim().regex(/^\+255\d{9}$/, "Use a Tanzanian number like +255712345678."),
  branchName: z.string().trim().min(2, "Add your first branch name."),
  branchZone: z.string().trim().optional().default(""),
});
type BusinessProfile = z.infer<typeof BusinessProfileSchema>;
type BusinessProfileInput = z.input<typeof BusinessProfileSchema>;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [slug, setSlug] = useState("");
  const [banner, setBanner] = useState<{ tone: "error" | "info"; message: string } | null>(null);
  const [pending, setPending] = useState(false);

  const form = useForm<BusinessProfileInput, unknown, BusinessProfile>({ resolver: zodResolver(BusinessProfileSchema) });
  const { register, handleSubmit, formState: { errors }, getValues } = form;

  async function createBusiness(values: BusinessProfile) {
    setPending(true);
    setBanner(null);
    const res = await createTenantAction({
      name: values.name,
      slug: values.slug,
      phone: values.phone,
      branches: [{ name: values.branchName, ward: values.branchZone || "" }],
    });
    setPending(false);
    if (!res.ok) {
      setBanner({ tone: "error", message: res.error });
      return;
    }
    setSlug(res.data.slug);
    setBanner({ tone: "info", message: "Business created. Continue setting up — your progress saves automatically." });
    setStep(2);
  }

  async function saveDraftAndNext() {
    if (!slug) return;
    setPending(true);
    const res = await saveOnboardingDraftAction({ slug, step, data: { ...getValues(), step } });
    setPending(false);
    if (!res.ok) {
      setBanner({ tone: "error", message: res.error });
      return;
    }
    if (step < STEPS.length) setStep(step + 1);
    else router.push(`/${slug}/dashboard`);
  }

  function goLive() {
    if (slug) router.push(`/${slug}/dashboard`);
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div>
        <p className="text-sm font-semibold text-[#0d7a5f]">Set up your business</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Step {step} of {STEPS.length}: {STEPS[step - 1]}</h1>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100">
          <div className="h-full rounded-full bg-[#0d7a5f] transition-all" style={{ width: `${(step / STEPS.length) * 100}%` }} />
        </div>
        <ol className="mt-3 flex flex-wrap gap-1.5">
          {STEPS.map((s, i) => (
            <li key={s} className={`rounded-full px-2.5 py-1 text-xs font-medium ${i + 1 === step ? "bg-[#0d7a5f] text-white" : i + 1 < step ? "bg-emerald-50 text-emerald-800" : "bg-zinc-100 text-zinc-500"}`}>
              {i + 1}. {s}
            </li>
          ))}
        </ol>
      </div>

      {banner && (
        <div role="alert" className={`rounded-xl px-4 py-3 text-sm ${banner.tone === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>
          {banner.message}
        </div>
      )}

      {step === 1 && (
        <form onSubmit={handleSubmit(createBusiness)} className="flex flex-col gap-4 rounded-3xl border border-zinc-100 bg-white p-6" noValidate>
          <div>
            <label htmlFor="name" className="text-sm font-medium">Business name</label>
            <input id="name" placeholder="Safi Cleaning Co." className="mt-1 w-full rounded-xl border border-zinc-200 px-4 py-2.5 outline-none focus:border-[#0d7a5f]" {...register("name")} />
            {errors.name && <p role="alert" className="mt-1 text-sm text-red-600">{errors.name.message}</p>}
          </div>
          <div>
            <label htmlFor="slug" className="text-sm font-medium">URL handle</label>
            <input id="slug" placeholder="safi-cleaning" className="mt-1 w-full rounded-xl border border-zinc-200 px-4 py-2.5 outline-none focus:border-[#0d7a5f]" {...register("slug")} />
            {errors.slug && <p role="alert" className="mt-1 text-sm text-red-600">{errors.slug.message}</p>}
            <p className="mt-1 text-xs text-zinc-500">Your dashboard will live at /your-handle/dashboard.</p>
          </div>
          <div>
            <label htmlFor="phone" className="text-sm font-medium">Business phone (M-Pesa / WhatsApp)</label>
            <input id="phone" placeholder="+255712345678" inputMode="tel" className="mt-1 w-full rounded-xl border border-zinc-200 px-4 py-2.5 outline-none focus:border-[#0d7a5f]" {...register("phone")} />
            {errors.phone && <p role="alert" className="mt-1 text-sm text-red-600">{errors.phone.message}</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="branchName" className="text-sm font-medium">First branch</label>
              <input id="branchName" placeholder="Msasani branch" className="mt-1 w-full rounded-xl border border-zinc-200 px-4 py-2.5 outline-none focus:border-[#0d7a5f]" {...register("branchName")} />
              {errors.branchName && <p role="alert" className="mt-1 text-sm text-red-600">{errors.branchName.message}</p>}
            </div>
            <div>
              <label htmlFor="branchZone" className="text-sm font-medium">Zone (optional)</label>
              <input id="branchZone" placeholder="Kinondoni" className="mt-1 w-full rounded-xl border border-zinc-200 px-4 py-2.5 outline-none focus:border-[#0d7a5f]" {...register("branchZone")} />
            </div>
          </div>
          <button type="submit" disabled={pending} className="rounded-full bg-[#0d7a5f] py-3 font-semibold text-white disabled:opacity-60">
            {pending ? "Creating…" : "Create business & continue"}
          </button>
        </form>
      )}

      {step > 1 && step < 7 && (
        <div className="rounded-3xl border border-zinc-100 bg-white p-6">
          <h2 className="font-semibold">{STEPS[step - 1]}</h2>
          <p className="mt-1 text-sm text-zinc-600">
            {step === 2 && "Add more branches and delivery zones from Settings once you are in the dashboard."}
            {step === 3 && "Your service catalog (home, office, sofa, post-construction) is managed under Services in the dashboard."}
            {step === 4 && "Invite cleaners and managers under Employees in the dashboard."}
            {step === 5 && "Set opening hours per branch under Settings in the dashboard."}
            {step === 6 && "Connect M-Pesa under Settings → Payments in the dashboard."}
          </p>
          <StepNav step={step} setStep={setStep} onNext={saveDraftAndNext} pending={pending} />
        </div>
      )}

      {step === 7 && (
        <div className="rounded-3xl bg-[#0d7a5f] p-6 text-white">
          <h2 className="text-lg font-bold">Connect WhatsApp</h2>
          <p className="mt-2 text-sm text-emerald-50">
            WhatsApp connection (QR pairing, message templates and the shared inbox) ships in Phase 4.
            Your number is already saved from step 1, so you will be first in line — for now continue setup and we will notify you.
          </p>
          <div className="mt-4 flex gap-2">
            <button onClick={() => setStep(step - 1)} className="rounded-full border border-white/40 px-5 py-2.5 text-sm font-semibold">Back</button>
            <button onClick={saveDraftAndNext} disabled={pending} className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-[#0d7a5f] disabled:opacity-60">
              {pending ? "Saving…" : "Continue without WhatsApp"}
            </button>
          </div>
        </div>
      )}

      {step > 7 && (
        <div className="rounded-3xl border border-zinc-100 bg-white p-6">
          <h2 className="font-semibold">{STEPS[step - 1]}</h2>
          <p className="mt-1 text-sm text-zinc-600">
            {step === 8 && "Message templates (confirmations, reminders, receipts) ship with Phase 4 WhatsApp."}
            {step === 9 && "The website booking widget ships in Phase 2 with the catalog."}
            {step === 10 && "You are ready. Open your dashboard to take your first booking."}
          </p>
          {step === 10 ? (
            <button onClick={goLive} className="mt-4 rounded-full bg-[#0d7a5f] px-6 py-3 font-semibold text-white">Go to dashboard</button>
          ) : (
            <StepNav step={step} setStep={setStep} onNext={saveDraftAndNext} pending={pending} />
          )}
        </div>
      )}
    </div>
  );
}

function StepNav({ step, setStep, onNext, pending }: { step: number; setStep: (n: number) => void; onNext: () => void; pending: boolean }) {
  return (
    <div className="mt-4 flex gap-2">
      <button onClick={() => setStep(Math.max(1, step - 1))} className="rounded-full border border-zinc-200 px-5 py-2.5 text-sm font-semibold">Back</button>
      <button onClick={onNext} disabled={pending} className="rounded-full bg-[#0d7a5f] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
        {pending ? "Saving…" : "Save & continue"}
      </button>
    </div>
  );
}
