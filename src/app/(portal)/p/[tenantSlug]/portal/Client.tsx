"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, LogOut, Star } from "lucide-react";
import {
  Button,
  Currency,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  StatusBadge,
} from "@/components/ui";
import type { StatusKind } from "@/components/ui/StatusBadge";
import { formatDate } from "@/lib/format";
import { t } from "@/i18n";
import {
  createPortalReviewAction,
  getPortalBookingsAction,
  getPortalInvoicesAction,
  logoutPortalAction,
  requestCodeAction,
  submitPortalPaymentAction,
  verifyCodeAction,
} from "@/app/actions/portal.actions";
import { getPublicTenantAction } from "@/app/actions/public.actions";
import {
  mapPortalBookings,
  mapPortalInvoices,
  type PortalBooking,
  type PortalInvoice,
} from "@/lib/portal-mappers";

const KIND_BY_STATUS: Record<string, StatusKind> = {
  pending: "pending",
  confirmed: "confirmed",
  scheduled: "info",
  in_progress: "in_progress",
  completed: "completed",
  paid: "success",
  partial: "warning",
  sent: "info",
  overdue: "danger",
  cancelled: "cancelled",
};

function kindOf(status: string): StatusKind {
  return KIND_BY_STATUS[status.toLowerCase()] ?? "pending";
}

function usePortalData(enabled: boolean, tenantId: string) {
  const bookings = useQuery({
    queryKey: ["portal-bookings"],
    queryFn: async (): Promise<PortalBooking[]> => {
      const res = await getPortalBookingsAction(tenantId);
      if (!res.ok) throw new Error(res.error);
      return mapPortalBookings(res.data);
    },
    enabled: enabled && tenantId.length > 0,
    staleTime: 15_000,
    retry: false,
  });
  const invoices = useQuery({
    queryKey: ["portal-invoices"],
    queryFn: async (): Promise<PortalInvoice[]> => {
      const res = await getPortalInvoicesAction(tenantId);
      if (!res.ok) throw new Error(res.error);
      return mapPortalInvoices(res.data);
    },
    enabled: enabled && tenantId.length > 0,
    staleTime: 15_000,
    retry: false,
  });
  return { bookings, invoices };
}

async function resolvePortalTenantId(slug: string): Promise<string> {
  const res = await getPublicTenantAction(slug);
  if (!res.ok) throw new Error(res.error);
  return res.data.id;
}

export function PortalClient({ slug }: { slug: string }) {
  const [authed, setAuthed] = useState(false);
  const [tenantId, setTenantId] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState<string[]>(["", "", "", "", "", ""]);
  const [codeSent, setCodeSent] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  const { bookings, invoices } = usePortalData(authed, tenantId);
  const client = useQueryClient();

  // If a session cookie already exists, the bookings call succeeds -> skip login.
  // The tenant id is resolved from the public tenant record first.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const id = await resolvePortalTenantId(slug);
        if (cancelled) return;
        setTenantId(id);
        const res = await getPortalBookingsAction(id);
        if (!cancelled && res.ok) setAuthed(true);
      } catch {
        // Stay on the login screen; the error surfaces on the next action.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function sendCode() {
    setAuthLoading(true);
    setAuthError(null);
    const res = await requestCodeAction(slug, phone.trim());
    setAuthLoading(false);
    if (!res.ok) {
      setAuthError(res.error);
      return;
    }
    setCodeSent(true);
  }

  async function verify() {
    const joined = code.join("");
    if (joined.length !== 6) {
      setAuthError("Please enter all 6 digits.");
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    const res = await verifyCodeAction(slug, phone.trim(), joined);
    setAuthLoading(false);
    if (!res.ok) {
      setAuthError(res.error);
      return;
    }
    setAuthed(true);
  }

  async function logout() {
    await logoutPortalAction();
    setAuthed(false);
    setCodeSent(false);
    setCode(["", "", "", "", "", ""]);
    client.clear();
  }

  if (!authed) {
    return (
      <section aria-labelledby="portal-login" className="rounded-3xl bg-white p-6 sm:p-8">
        <h1 id="portal-login" className="text-lg font-bold">{t("portal.loginTitle")}</h1>
        <p className="mt-1 text-sm text-zinc-600">{t("portal.loginBody")}</p>
        <div className="mt-4 grid gap-3">
          <Input
            label={t("portal.phoneLabel")}
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          {!codeSent ? (
            <Button onClick={sendCode} loading={authLoading} style={{ background: "var(--brand)" }}>
              {t("portal.sendCode")}
            </Button>
          ) : (
            <>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                {t("portal.codeLabel")}
                <span className="grid grid-cols-6 gap-2" role="group" aria-label={t("portal.codeLabel")}>
                  {code.map((d, i) => (
                    <input
                      key={i}
                      aria-label={`Digit ${i + 1}`}
                      inputMode="numeric"
                      maxLength={1}
                      value={d}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, "").slice(0, 1);
                        setCode((c) => {
                          const next = [...c];
                          next[i] = v;
                          return next;
                        });
                        if (v && i < 5) {
                          document.getElementById(`portal-code-${i + 1}`)?.focus();
                        }
                      }}
                      id={`portal-code-${i}`}
                      className="h-12 rounded-xl border border-zinc-200 text-center text-lg font-bold tabular-nums outline-none focus:border-[var(--brand)]"
                    />
                  ))}
                </span>
              </label>
              <Button onClick={verify} loading={authLoading} style={{ background: "var(--brand)" }}>
                {t("portal.verify")}
              </Button>
            </>
          )}
          {authError ? (
            <ErrorState message={authError} onRetry={() => setAuthError(null)} retryLabel={t("common.retry")} />
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">{t("portal.title")}</h1>
        <Button variant="secondary" size="sm" onClick={logout}>
          <LogOut size={18} aria-hidden="true" /> {t("portal.logout")}
        </Button>
      </div>

      {/* Bookings */}
      <section aria-labelledby="pb" className="rounded-3xl bg-white p-5 sm:p-6">
        <h2 id="pb" className="font-bold">{t("portal.bookingsTitle")}</h2>
        <div className="mt-3">
          {bookings.isPending ? <LoadingState label={t("common.loading")} /> : null}
          {bookings.isError ? (
            <ErrorState message={(bookings.error as Error).message} onRetry={() => bookings.refetch()} />
          ) : null}
          {bookings.data && bookings.data.length === 0 ? (
            <EmptyState title={t("portal.emptyBookings")} />
          ) : null}
          {bookings.data && bookings.data.length > 0 ? (
            <ul className="grid gap-2">
              {bookings.data.map((b) => (
                <li key={b.reference} className="rounded-2xl border border-zinc-100 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-bold tabular-nums">{b.reference}</span>
                    <StatusBadge status={kindOf(b.status)} label={b.status} />
                  </div>
                  <p className="mt-1 text-sm text-zinc-600">
                    {b.serviceName} · {formatDate(b.scheduledAt, "DD MMM YYYY")}
                  </p>
                  <div className="mt-1 flex items-center justify-between text-sm">
                    <Currency amountMinor={b.totalMinor} />
                    {b.balanceMinor > 0 ? (
                      <span className="text-zinc-600">
                        {t("portal.balance")}: <Currency amountMinor={b.balanceMinor} />
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <CheckCircle2 size={18} aria-hidden="true" /> Paid
                      </span>
                    )}
                  </div>
                  <ReviewForm bookingReference={b.reference} tenantId={tenantId} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      {/* Invoices */}
      <section aria-labelledby="pi" className="rounded-3xl bg-white p-5 sm:p-6">
        <h2 id="pi" className="font-bold">{t("portal.invoicesTitle")}</h2>
        <div className="mt-3">
          {invoices.isPending ? <LoadingState label={t("common.loading")} /> : null}
          {invoices.isError ? (
            <ErrorState message={(invoices.error as Error).message} onRetry={() => invoices.refetch()} />
          ) : null}
          {invoices.data && invoices.data.length === 0 ? (
            <EmptyState title={t("portal.emptyInvoices")} />
          ) : null}
          {invoices.data && invoices.data.length > 0 ? (
            <ul className="grid gap-2">
              {invoices.data.map((inv) => (
                <li key={inv.reference} className="rounded-2xl border border-zinc-100 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-bold tabular-nums">{inv.reference}</span>
                    <StatusBadge status={kindOf(inv.status)} label={inv.status} />
                  </div>
                  <p className="mt-1 text-sm text-zinc-600">Due {formatDate(inv.dueDate)}</p>
                  <div className="mt-1 flex items-center justify-between text-sm">
                    <Currency amountMinor={inv.totalMinor} />
                    <span className="text-zinc-600">
                      {t("portal.balance")}: <Currency amountMinor={inv.balanceMinor} />
                    </span>
                  </div>
                  {inv.balanceMinor > 0 ? <PayModal invoice={inv} tenantId={tenantId} /> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function PayModal({ invoice, tenantId }: { invoice: PortalInvoice; tenantId: string }) {
  const [open, setOpen] = useState(false);
  const [amountMajor, setAmountMajor] = useState((invoice.balanceMinor / 100).toString());
  const [providerRef, setProviderRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pay = useMutation({
    mutationFn: async () => {
      const amountMinor = Math.round(Number(amountMajor) * 100);
      if (!Number.isFinite(amountMinor) || amountMinor <= 0)
        throw new Error("Enter an amount greater than zero.");
      if (!/^[A-Z0-9]{8,12}$/.test(providerRef.trim()))
        throw new Error("Enter a valid M-Pesa code: 8-12 uppercase letters or digits.");
      const res = await submitPortalPaymentAction(tenantId, {
        invoiceReference: invoice.reference,
        amountMinor,
        providerRef: providerRef.trim(),
      });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
  });

  return (
    <>
      <Button variant="secondary" size="sm" className="mt-2" onClick={() => { setOpen(true); setError(null); pay.reset(); }}>
        {t("portal.markPaid")}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("portal.markPaid")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button
              loading={pay.isPending}
              onClick={() => pay.mutate(undefined, { onSuccess: () => setOpen(false), onError: (e) => setError(e.message) })}
              style={{ background: "var(--brand)" }}
            >
              {t("portal.submit")}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Input label={t("portal.amountLabel")} inputMode="decimal" value={amountMajor} onChange={(e) => setAmountMajor(e.target.value)} />
          <Input label={t("portal.txnLabel")} placeholder="e.g. QA12BC34DE" value={providerRef} onChange={(e) => setProviderRef(e.target.value.toUpperCase())} />
          {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
          {pay.isSuccess ? <p role="status" className="text-sm text-emerald-700">{t("portal.paidSuccess")}</p> : null}
        </div>
      </Modal>
    </>
  );
}

function ReviewForm({ bookingReference, tenantId }: { bookingReference: string; tenantId: string }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const review = useMutation({
    mutationFn: async () => {
      const res = await createPortalReviewAction(tenantId, { bookingReference, rating, comment: comment.trim() });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
  });

  if (review.isSuccess) {
    return <p role="status" className="mt-2 text-sm text-emerald-700">{t("portal.reviewSuccess")}</p>;
  }

  return (
    <div className="mt-2">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold underline" style={{ color: "var(--brand)" }}>
          {t("portal.reviewTitle")}
        </button>
      ) : (
        <div className="rounded-xl bg-zinc-50 p-3">
          <div role="radiogroup" aria-label={t("portal.ratingLabel")} className="flex gap-1">
            {[1, 2, 3, 4, 5].map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={rating === s}
                aria-label={`${s} star${s > 1 ? "s" : ""}`}
                onClick={() => setRating(s)}
              >
                <Star size={18} aria-hidden="true" className={s <= rating ? "fill-amber-400 text-amber-400" : "text-zinc-300"} />
              </button>
            ))}
          </div>
          <label className="mt-2 flex flex-col gap-1 text-sm">
            {t("portal.commentLabel")}
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
            />
          </label>
          {error ? <p role="alert" className="mt-1 text-sm text-red-600">{error}</p> : null}
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              loading={review.isPending}
              onClick={() => review.mutate(undefined, { onError: (e) => setError(e.message) })}
              style={{ background: "var(--brand)" }}
            >
              {t("portal.sendReview")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
