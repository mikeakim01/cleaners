"use client";

import { useState } from "react";
import { Pencil, Plus, Power } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  Currency,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  StatusBadge,
} from "@/components/ui";
import { useAdminMutations, usePlans } from "@/hooks/useAdmin";
import type { PlanInput, PlatformPlan } from "@/lib/admin-mappers";
import { t } from "@/i18n";

const EMPTY_FORM: PlanInput = {
  name: "",
  priceMinor: 0,
  currency: "TZS",
  trialDays: 14,
  limits: {},
  active: true,
};

function toMajor(minor: number): string {
  return String(Math.round(minor) / 100);
}

function toMinor(major: string): number {
  const n = Number(major);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
}

export function PlansClient({
  initial,
  initialError,
}: {
  initial: PlatformPlan[] | null;
  initialError: string | null;
}) {
  const query = usePlans();
  const data = query.data ?? initial;
  const mutations = useAdminMutations();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PlatformPlan | null>(null);
  const [form, setForm] = useState<PlanInput>(EMPTY_FORM);
  const [priceMajor, setPriceMajor] = useState("0");
  const [formError, setFormError] = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState<PlatformPlan | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setPriceMajor("0");
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (plan: PlatformPlan) => {
    setEditing(plan);
    setForm({
      name: plan.name,
      priceMinor: plan.priceMinor,
      currency: plan.currency,
      trialDays: plan.trialDays,
      limits: plan.limits,
      active: plan.active,
    });
    setPriceMajor(toMajor(plan.priceMinor));
    setFormError(null);
    setModalOpen(true);
  };

  const save = async () => {
    setFormError(null);
    setFeedback(null);
    if (!form.name.trim()) {
      setFormError(t("common.required"));
      return;
    }
    const priceMinor = toMinor(priceMajor);
    if (!Number.isFinite(priceMinor)) {
      setFormError(t("admin.priceInvalid"));
      return;
    }
    const values: PlanInput = { ...form, name: form.name.trim(), priceMinor };
    try {
      if (editing) {
        await mutations.updatePlan.mutateAsync({
          planId: editing.id,
          values,
        });
      } else {
        await mutations.createPlan.mutateAsync(values);
      }
      setFeedback(t("common.success"));
      setModalOpen(false);
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  const confirmDeactivate = async () => {
    if (!deactivating) return;
    setFeedback(null);
    try {
      await mutations.deactivatePlan.mutateAsync(deactivating.id);
      setFeedback(t("common.success"));
      setDeactivating(null);
    } catch (e) {
      setFeedback((e as Error).message);
    }
  };

  const saving = mutations.createPlan.isPending || mutations.updatePlan.isPending;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold tracking-tight">{t("admin.plans")}</h1>
        <span className="ml-auto">
          <Button size="sm" onClick={openCreate}>
            <Plus size={18} aria-hidden="true" />
            {t("admin.newPlan")}
          </Button>
        </span>
      </div>

      {feedback ? (
        <p
          role="status"
          className="rounded-card bg-tint px-4 py-2 text-sm text-primary"
        >
          {feedback}
        </p>
      ) : null}

      {query.isPending && !data ? (
        <LoadingState label={t("common.loading")} />
      ) : query.isError && !data ? (
        <ErrorState
          message={initialError ?? (query.error as Error).message}
          onRetry={() => query.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : (data ?? []).length === 0 ? (
        <EmptyState
          title={t("admin.emptyPlans")}
          description={initialError ?? undefined}
          action={
            <Button size="sm" onClick={openCreate}>
              {t("admin.newPlan")}
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(data ?? []).map((plan) => (
            <li
              key={plan.id}
              className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4"
            >
              <span className="flex items-center gap-2">
                <span className="text-base font-bold text-ink">
                  {plan.name}
                </span>
                <StatusBadge
                  status={plan.active ? "success" : "cancelled"}
                  label={
                    plan.active ? t("admin.active") : t("admin.inactive")
                  }
                />
              </span>
              <Currency
                amountMinor={plan.priceMinor}
                currency={plan.currency}
                className="text-lg"
              />
              <p className="text-sm tabular-nums text-muted">
                {t("admin.trialDays")}: {plan.trialDays}
              </p>
              {Object.keys(plan.limits).length > 0 ? (
                <ul className="text-sm text-muted">
                  {Object.entries(plan.limits).map(([k, v]) => (
                    <li key={k} className="tabular-nums">
                      {k}: {v}
                    </li>
                  ))}
                </ul>
              ) : null}
              <span className="mt-auto flex gap-2 pt-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => openEdit(plan)}
                >
                  <Pencil size={18} aria-hidden="true" />
                  {t("admin.editPlan")}
                </Button>
                {plan.active ? (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => setDeactivating(plan)}
                  >
                    <Power size={18} aria-hidden="true" />
                    {t("admin.deactivate")}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? t("admin.editPlan") : t("admin.newPlan")}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setModalOpen(false)}
              disabled={saving}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={save} loading={saving}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            label={t("admin.colName")}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Input
            label={`${t("admin.colPrice")} (TZS)`}
            inputMode="decimal"
            value={priceMajor}
            onChange={(e) => setPriceMajor(e.target.value)}
          />
          <Input
            label={t("admin.trialDays")}
            inputMode="numeric"
            value={String(form.trialDays)}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                trialDays: Number(e.target.value) || 0,
              }))
            }
          />
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) =>
                setForm((f) => ({ ...f, active: e.target.checked }))
              }
              className="size-4 accent-[#0F766E]"
            />
            {t("admin.active")}
          </label>
          {formError ? (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={deactivating !== null}
        title={t("admin.deactivateTitle")}
        message={t("admin.deactivateBody")}
        confirmLabel={t("admin.deactivate")}
        cancelLabel={t("common.cancel")}
        danger
        loading={mutations.deactivatePlan.isPending}
        onConfirm={confirmDeactivate}
        onCancel={() => setDeactivating(null)}
      />
    </div>
  );
}
