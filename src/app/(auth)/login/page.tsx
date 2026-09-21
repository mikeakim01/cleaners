"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { AuthShell, FieldError, FormBanner } from "../_components";

const LoginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(6, "Password must be at least 6 characters."),
});
type LoginInput = z.infer<typeof LoginSchema>;

function friendlyAuthError(message: string): string {
  if (/invalid login|invalid.*credentials/i.test(message)) return "Wrong email or password. Please try again.";
  if (/email not confirmed/i.test(message)) return "Please confirm your email first, then sign in.";
  if (/too many requests/i.test(message)) return "Too many attempts. Wait a minute and try again.";
  return message || "Could not sign you in. Please try again.";
}

export default function LoginPage() {
  const router = useRouter();
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
  });

  async function onSubmit(values: LoginInput) {
    setPending(true);
    setFormError(undefined);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword(values);
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
    <AuthShell title="Welcome back" subtitle="Sign in to manage your cleaning business.">
      <FormBanner tone="error" message={formError} />
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <div>
          <label htmlFor="email" className="text-sm font-medium">Email</label>
          <input id="email" type="email" autoComplete="email" placeholder="you@company.co.tz"
            className="mt-1 w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-base outline-none focus:border-[#0d7a5f]"
            {...register("email")} />
          <FieldError message={errors.email?.message} />
        </div>
        <div>
          <label htmlFor="password" className="text-sm font-medium">Password</label>
          <input id="password" type="password" autoComplete="current-password" placeholder="••••••••"
            className="mt-1 w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-base outline-none focus:border-[#0d7a5f]"
            {...register("password")} />
          <FieldError message={errors.password?.message} />
        </div>
        <button type="submit" disabled={pending}
          className="rounded-full bg-[#0d7a5f] py-3 text-base font-semibold text-white disabled:opacity-60">
          {pending ? "Signing you in…" : "Sign in"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-zinc-600">
        New here? <Link href="/register" className="font-semibold text-[#0d7a5f]">Create an account</Link>
      </p>
    </AuthShell>
  );
}
