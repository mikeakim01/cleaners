"use server";

import { headers } from "next/headers";
import { AppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { saveOnboardingDraft } from "@/services/onboarding.service";

export async function saveOnboardingDraftAction(raw: unknown) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError("Please sign in to continue.");
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;

    const { step } = await saveOnboardingDraft(user.id, raw, ip);
    return { ok: true as const, data: { step } };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof AppError ? err.message : "Could not save your progress. Please try again.",
    };
  }
}
