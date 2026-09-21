"use server";

import { cookies } from "next/headers";
import { AppError } from "@/lib/errors";
import { PORTAL_COOKIE, signPortalSession, verifyPortalSession } from "@/lib/portal-session";
import {
  getPortalCustomer,
  listPortalBookings,
  listPortalInvoices,
  requestLoginCode,
  submitPortalPayment,
  verifyLoginCode,
} from "@/services/portal.service";
import { createReview } from "@/services/reviews.service";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function toError(err: unknown): string {
  if (err instanceof AppError) return err.message;
  if (err instanceof Error) return err.message || "Something went wrong. Please try again.";
  return "Something went wrong. Please try again.";
}

const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

async function readPortalSession(): Promise<{ tenantId: string; customerId: string }> {
  const store = await cookies();
  const raw = store.get(PORTAL_COOKIE)?.value;
  const session = verifyPortalSession(raw);
  if (!session) throw new AppError("Your portal session has expired. Please log in again.");
  return session;
}

function assertSessionTenant(session: { tenantId: string }, tenantId: string): void {
  if (session.tenantId !== tenantId) {
    throw new AppError("Your portal session has expired. Please log in again.");
  }
}

export async function requestCodeAction(
  slug: unknown,
  phone: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof requestLoginCode>>>> {
  try {
    const data = await requestLoginCode(slug, phone);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function verifyCodeAction(
  slug: unknown,
  phone: unknown,
  code: unknown,
): Promise<ActionResult<{ customerId: string; tenantId: string }>> {
  try {
    const { customer } = await verifyLoginCode(slug, phone, code);
    const token = signPortalSession({ tenantId: customer.tenant_id, customerId: customer.id });
    const store = await cookies();
    store.set(PORTAL_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
    return { ok: true, data: { customerId: customer.id, tenantId: customer.tenant_id } };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function logoutPortalAction(): Promise<ActionResult<null>> {
  try {
    const store = await cookies();
    store.delete(PORTAL_COOKIE);
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function getPortalCustomerAction(
  tenantId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof getPortalCustomer>>>> {
  try {
    const session = await readPortalSession();
    assertSessionTenant(session, tenantId);
    const data = await getPortalCustomer(session.tenantId, session.customerId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function getPortalBookingsAction(
  tenantId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof listPortalBookings>>>> {
  try {
    const session = await readPortalSession();
    assertSessionTenant(session, tenantId);
    const data = await listPortalBookings(session.tenantId, session.customerId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function getPortalInvoicesAction(
  tenantId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof listPortalInvoices>>>> {
  try {
    const session = await readPortalSession();
    assertSessionTenant(session, tenantId);
    const data = await listPortalInvoices(session.tenantId, session.customerId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function submitPortalPaymentAction(
  tenantId: string,
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof submitPortalPayment>>>> {
  try {
    const session = await readPortalSession();
    assertSessionTenant(session, tenantId);
    const data = await submitPortalPayment(session.tenantId, session.customerId, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function createPortalReviewAction(
  tenantId: string,
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof createReview>>>> {
  try {
    const session = await readPortalSession();
    assertSessionTenant(session, tenantId);
    const data = await createReview(
      session.tenantId,
      { kind: "portal", customerId: session.customerId },
      input,
      "portal",
    );
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}
