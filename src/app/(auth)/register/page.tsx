"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { AuthShell, FieldError, FormBanner } from "../_components";

const RegisterSchema = z.object({
  fullName: z.string().trim().min(2, "Tell us your name (at least 2 characters)."),
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters for your password."),
});
type RegisterInput = z.infer<typeof RegisterSchema>;

function friendlyAuthError(message: string): string {
  if (/already registered|already exists|duplicate/i.test(message)) return "This email is already registered. Try signing in instead.";
  if (/password/i.test(message)) return "That password is too weak. Use at least 8 characters.";
  return message || "Could not create your account. Please try again.";
}

export default function RegisterPage() {
  const router = useRouter();
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<RegisterInput>({
    resolver: zodResolver(RegisterSchema),
  });

  async function onSubmit(values: RegisterInput) {
    setPending(true);
    setFormError(undefined);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signUp({
        email: values.email,
        password: values.password,
        options: { data: { full_name: values.fullName } },
      });
      if (error) throw new Error(error.message);
      router.push("/onboarding");
      router.refresh();
    } catch (err) {
      setFormError(friendlyAuthError(err instanceof Error ? err.message : ""));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell title="Start your free trial" subtitle="14 days free. No card required.">
      <FormBanner tone="error" message={formError} />
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <div>
          <label htmlFor="fullName" className="text-sm font-medium">Your name</label>
          <input id="fullName" type="text" autoComplete="name" placeholder="Amina Juma"
            className="mt-1 w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-base outline-none focus:border-[#0d7a5f]"
            {...register("fullName")} />
          <FieldError message={errors.fullName?.message} />
        </div>
        <div>
          <label htmlFor="email" className="text-sm font-medium">Work email</label>
          <input id="email" type="email" autoComplete="email" placeholder="you@company.co.tz"
            className="mt-1 w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-base outline-none focus:border-[#0d7a5f]"
            {...register("email")} />
          <FieldError message={errors.email?.message} />
        </div>
        <div>
          <label htmlFor="password" className="text-sm font-medium">Password</label>
          <input id="password" type="password" autoComplete="new-password" placeholder="At least 8 characters"
            className="mt-1 w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-base outline-none focus:border-[#0d7a5f]"
            {...register("password")} />
          <FieldError message={errors.password?.message} />
        </div>
        <button type="submit" disabled={pending}
          className="rounded-full bg-[#0d7a5f] py-3 text-base font-semibold text-white disabled:opacity-60">
          {pending ? "Creating your account…" : "Create account"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-zinc-600">
        Have an account? <Link href="/login" className="font-semibold text-[#0d7a5f]">Sign in</Link>
      </p>
    </AuthShell>
  );
}
