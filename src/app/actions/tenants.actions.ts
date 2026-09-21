"use server";

import { headers } from "next/headers";
import { AppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/services/audit.service";
import {
  createTenant,
  getTenantBySlug,
  listMyTenants,
} from "@/services/tenants.service";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function toError(err: unknown): string {
  if (err instanceof AppError) return err.message;
  if (err instanceof Error) return err.message || "Something went wrong. Please try again.";
  return "Something went wrong. Please try again.";
}

async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new AppError("Please sign in to continue.");
  return user.id;
}

async function requestIp(): Promise<string | undefined> {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
}

export async function createTenantAction(
  input: unknown,
): Promise<ActionResult<{ id: string; slug: string }>> {
  try {
    const userId = await requireUserId();
    const tenant = await createTenant(userId, input, await requestIp());
    return { ok: true, data: { id: tenant.id, slug: tenant.slug } };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function listMyTenantsAction(): Promise<
  ActionResult<Awaited<ReturnType<typeof listMyTenants>>>
> {
  try {
    const data = await listMyTenants(await requireUserId());
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function getTenantAction(
  slug: string,
): Promise<ActionResult<Awaited<ReturnType<typeof getTenantBySlug>>>> {
  try {
    const data = await getTenantBySlug(await requireUserId(), slug);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

/** Audit passthrough so client flows can record activity without touching the DB directly. */
export async function logAuditAction(input: {
  tenantId: string;
  action: string;
  entity: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}): Promise<ActionResult<null>> {
  try {
    const userId = await requireUserId();
    await writeAudit({ ...input, userId, ip: await requestIp() });
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}
