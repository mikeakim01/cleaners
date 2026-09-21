"use client";

import { useState } from "react";
import { Banknote, CreditCard, Receipt, Smartphone } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  Currency,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Select,
  StatusBadge,
} from "@/components/ui";
import type { StatusKind } from "@/components/ui/StatusBadge";
import { useBillingMutations, useBillingState } from "@/hooks/useBilling";
import type { BillingStateData } from "@/lib/admin-mappers";
import { formatDate, formatMoney } from "@/lib/format";
import { t } from "@/i18n";

const KIND_BY_STATUS: Record<string, StatusKind> = {
  active: "success",
  trialing: "warning",
  past_due: "danger",
  cancelled: "cancelled",
};

const PROVIDER_OPTIONS = [
  { value: "mobile_money", label: "M-Pesa" },
  { value: "bank_transfer", label: "Bank" },
  { value: "cash", label: "Cash" },
];

function UsageMeters({ usage }: { usage: BillingStateData["usage"] }) {
  if (usage.length === 0) {
    return <p className="text-sm text-muted">{t("billing.noUsage")}</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {usage.map((u) => {
        const pct =
          u.limit > 0 ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0;
        return (
          <li key={u.key} className="text-sm">
            <span className="flex items-baseline justify-between gap-2">
              <span className="font-medium text-ink">{u.key}</span>
              <span className="tabular-nums text-muted">
                {u.used.toLocaleString("en-GB")} /{" "}
                {u.limit > 0 ? u.limit.toLocaleString("en-GB") : "∞"}
              </span>
            </span>
            <span
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={u.key}
              className="mt-1 block h-2 overflow-hidden rounded-full bg-canvas"
            >
              <span
                aria-hidden="true"
                className="block h-full rounded-full bg-primary"
                style={{ width: `${pct}%` }}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function BillingClient({
  tenantId,
  tenantSlug,
  initial,
  initialError,
}: {
  tenantId: string;
  tenantSlug: string;
  initial: BillingStateData | null;
  initialError: string | null;
}) {
  const query = useBillingState(tenantId);
  const data = query.data ?? initial;
  const mutations = useBillingMutations(tenantId);

  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [changeOpen, setChangeOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [amountMajor, setAmountMajor] = useState("");
  const [provider, setProvider] = useState("mobile_money");
  const [providerRef, setProviderRef] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (query.isPending && !data) {
    return <LoadingState label={t("common.loading")} />;
  }
  if (query.isError && !data) {
    return (
      <ErrorState
        message={initialError ?? (query.error as Error).message}
        onRetry={() => query.refetch()}
        retryLabel={t("common.retry")}
      />
    );
  }
  if (!data) {
    return (
      <EmptyState
        title={t("common.empty")}
        description={initialError ?? undefined}
      />
    );
  }

  const sub = data.subscription;
  const plans = data.plans ?? [];
  const chosen = plans.find((p) => p.id === selectedPlan) ?? null;

  const confirmChange = async () => {
    if (!selectedPlan) return;
    setFeedback(null);
    try {
      await mutations.changePlan.mutateAsync(selectedPlan);
      setFeedback(t("billing.changeSuccess"));
      setChangeOpen(false);
    } catch (e) {
      setFeedback((e as Error).message);
    }
  };

  const confirmCancel = async () => {
    setFeedback(null);
    try {
      await mutations.cancel.mutateAsync();
      setFeedback(t("billing.cancelSuccess"));
      setCancelOpen(false);
    } catch (e) {
      setFeedback((e as Error).message);
    }
  };

  const submitPayment = async () => {
    setFormError(null);
    setFeedback(null);
    const n = Number(amountMajor);
    if (!Number.isFinite(n) || n <= 0) {
      setFormError(t("billing.amountInvalid"));
      return;
    }
    try {
      await mutations.recordPayment.mutateAsync({
        amountMinor: Math.round(n * 100),
        provider,
        providerRef: providerRef.trim() || undefined,
      });
      setFeedback(t("billing.recordSuccess"));
      setAmountMajor("");
      setProviderRef("");
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold tracking-tight">{t("billing.title")}</h1>
      <p className="-mt-2 text-sm text-muted">{t("billing.subtitle")}</p>

      {feedback ? (
        <p
          role="status"
          className="rounded-card bg-tint px-4 py-2 text-sm text-primary"
        >
          {feedback}
        </p>
      ) : null}

      {/* Current plan */}
      <section
        aria-label={t("billing.currentPlan")}
        className="rounded-card border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-2 text-base font-bold text-ink">
            <CreditCard size={18} aria-hidden="true" />
            {sub.planName}
          </h2>
          <StatusBadge
            status={KIND_BY_STATUS[sub.status] ?? "pending"}
            label={sub.status}
          />
          <span className="ml-auto">
            <Currency
              amountMinor={sub.priceMinor}
              currency={sub.currency}
              className="text-lg"
            />
          </span>
        </div>
        <p className="mt-2 text-sm tabular-nums text-muted">
          {sub.status === "trialing" && sub.trialEndsAt
            ? `${t("billing.trialEndsOn")} ${formatDate(sub.trialEndsAt)}`
            : null}
          {sub.currentPeriodEnd
            ? ` · ${t("billing.periodEnds")} ${formatDate(sub.currentPeriodEnd)}`
            : null}
          {!sub.trialEndsAt && !sub.currentPeriodEnd
            ? t("billing.noPeriod")
            : null}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="danger"
            onClick={() => setCancelOpen(true)}
          >
            {t("billing.cancel")}
          </Button>
        </div>
      </section>

      {/* Usage */}
      <section
        aria-label={t("billing.usage")}
        className="rounded-card border border-border bg-surface p-4"
      >
        <h2 className="mb-3 text-sm font-semibold text-ink">
          {t("billing.usage")}
        </h2>
        <UsageMeters usage={data.usage} />
      </section>

      {/* Plan catalogue */}
      <section
        aria-label={t("billing.plans")}
        className="rounded-card border border-border bg-surface p-4"
      >
        <h2 className="mb-3 text-sm font-semibold text-ink">
          {t("billing.plans")}
        </h2>
        {plans.length === 0 ? (
          <EmptyState title={t("billing.noPlans")} />
        ) : (
          <div className="flex flex-col gap-2">
            <ul className="flex flex-col gap-2" role="radiogroup" aria-label={t("billing.plans")}>
              {plans.map((p) => (
                <li key={p.id}>
                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-card border px-3 py-2.5 ${
                      selectedPlan === p.id
                        ? "border-primary bg-tint"
                        : "border-border"
                    }`}
                  >
                    <input
                      type="radio"
                      name="billing-plan"
                      value={p.id}
                      checked={selectedPlan === p.id}
                      onChange={() => setSelectedPlan(p.id)}
                      className="mt-1 size-4 accent-[#0F766E]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-semibold text-ink">{p.name}</span>
                        <span className="tabular-nums text-sm text-muted">
                          {formatMoney(p.priceMinor, p.currency)}
                        </span>
                      </span>
                      {p.features.length > 0 ? (
                        <span className="mt-0.5 block text-xs text-muted">
                          {p.features.join(" · ")}
                        </span>
                      ) : null}
                      {p.trialDays > 0 ? (
                        <span className="mt-0.5 block text-xs tabular-nums text-muted">
                          {p.trialDays} {t("billing.trialDaysFree")}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <span>
              <Button
                size="sm"
                disabled={!selectedPlan || mutations.changePlan.isPending}
                loading={mutations.changePlan.isPending}
                onClick={() => setChangeOpen(true)}
              >
                {t("billing.changePlan")}
              </Button>
            </span>
          </div>
        )}
      </section>

      {/* Record payment */}
      <section
        aria-label={t("billing.recordPayment")}
        className="rounded-card border border-border bg-surface p-4"
      >
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
          <Receipt size={18} aria-hidden="true" />
          {t("billing.recordPayment")}
        </h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input
            label={`${t("billing.amount")} (${sub.currency})`}
            inputMode="decimal"
            value={amountMajor}
            onChange={(e) => setAmountMajor(e.target.value)}
          />
          <Select
            label={t("billing.provider")}
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            options={PROVIDER_OPTIONS}
          />
        </div>
        <div className="mt-2">
          <Input
            label={t("billing.providerRef")}
            placeholder={t("billing.providerRefHint")}
            value={providerRef}
            onChange={(e) => setProviderRef(e.target.value)}
            icon={
              provider === "mobile_money" ? (
                <Smartphone size={18} aria-hidden="true" />
              ) : (
                <Banknote size={18} aria-hidden="true" />
              )
            }
          />
        </div>
        {formError ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {formError}
          </p>
        ) : null}
        <div className="mt-3">
          <Button
            size="sm"
            onClick={submitPayment}
            loading={mutations.recordPayment.isPending}
          >
            {t("billing.recordPayment")}
          </Button>
        </div>
      </section>

      {/* Events history */}
      <section aria-label={t("billing.events")}>
        <h2 className="mb-2 text-sm font-semibold text-ink">
          {t("billing.events")}
        </h2>
        <DataTable
          columns={[
            { key: "type", header: t("billing.colType") },
            {
              key: "amount",
              header: t("billing.colAmount"),
              align: "right",
              render: (row) => (
                <Currency
                  amountMinor={row.amountMinor}
                  currency={sub.currency}
                />
              ),
            },
            {
              key: "date",
              header: t("billing.colDate"),
              render: (row) => (
                <span className="tabular-nums">
                  {formatDate(row.createdAt)}
                </span>
              ),
            },
          ]}
          rows={data.events}
          getRowKey={(row, i) => `${row.type}-${row.createdAt}-${i}`}
          emptyTitle={t("billing.eventsEmpty")}
        />
      </section>

      <p className="text-xs text-muted">
        {t("billing.tenantRef")}: <span className="tabular-nums">{tenantSlug}</span>
      </p>

      <ConfirmDialog
        open={changeOpen}
        title={t("billing.changeTitle")}
        message={`${t("billing.changeBody")} ${chosen ? chosen.name : ""}`}
        confirmLabel={t("billing.changeConfirm")}
        cancelLabel={t("common.cancel")}
        loading={mutations.changePlan.isPending}
        onConfirm={confirmChange}
        onCancel={() => setChangeOpen(false)}
      />

      <ConfirmDialog
        open={cancelOpen}
        title={t("billing.cancelTitle")}
        message={t("billing.cancelBody")}
        confirmLabel={t("billing.cancelConfirm")}
        cancelLabel={t("common.cancel")}
        danger
        loading={mutations.cancel.isPending}
        onConfirm={confirmCancel}
        onCancel={() => setCancelOpen(false)}
      />
    </div>
  );
}
