"use server";

import { AppError } from "@/lib/errors";
import { createPublicBooking, getPublicTenant } from "@/services/public.service";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function toError(err: unknown): string {
  if (err instanceof AppError) return err.message;
  if (err instanceof Error) return err.message || "Something went wrong. Please try again.";
  return "Something went wrong. Please try again.";
}

export async function getPublicTenantAction(
  slug: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof getPublicTenant>>>> {
  try {
    const data = await getPublicTenant(slug);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function createPublicBookingAction(
  slug: unknown,
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof createPublicBooking>>>> {
  try {
    const data = await createPublicBooking(slug, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}
