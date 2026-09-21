"use client";

import { useMemo, useState } from "react";
import { BellRing } from "lucide-react";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Select,
} from "@/components/ui";
import { useAutomationRules, useTemplates } from "@/hooks/useWhatsApp";
import { t } from "@/i18n";

const EVENTS = [
  "booking_created",
  "booking_confirmed",
  "booking_reminder_24h",
  "job_assigned",
  "job_en_route",
  "job_completed",
  "quote_sent",
  "invoice_sent",
  "payment_received",
] as const;

type EventKey = (typeof EVENTS)[number];

function eventLabel(event: EventKey): string {
  return t(`whatsapp.automations.event_${event}` as Parameters<typeof t>[0]);
}

function eventDesc(event: EventKey): string {
  return t(`whatsapp.automations.event_${event}_desc` as Parameters<typeof t>[0]);
}

export function AutomationsClient({ tenantId }: { tenantId: string }) {
  const rules = useAutomationRules(tenantId);
  const templates = useTemplates(tenantId);
  const [drafts, setDrafts] = useState<Record<string, { templateId: string; active: boolean }>>({});
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const approved = useMemo(
    () => (templates.data ?? []).filter((tpl) => tpl.status === "APPROVED"),
    [templates.data],
  );

  const serverRules = useMemo(() => {
    const map = new Map((rules.data ?? []).map((r) => [r.event, r]));
    return map;
  }, [rules.data]);

  const valueFor = (event: string) => {
    const draft = drafts[event];
    if (draft) return draft;
    const server = serverRules.get(event);
    return { templateId: server?.templateId ?? "", active: server?.active ?? false };
  };

  const patch = (event: string, p: Partial<{ templateId: string; active: boolean }>) =>
    setDrafts((d) => ({ ...d, [event]: { ...valueFor(event), ...p } }));

  const save = async (event: string) => {
    setSaving(event);
    setSavedNote(null);
    try {
      const v = valueFor(event);
      await rules.upsert.mutateAsync({ event, templateId: v.templateId || null, active: v.active });
      setSavedNote(t("whatsapp.automations.saveSuccess"));
    } catch (e) {
      setSavedNote((e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  if (rules.isPending) return <LoadingState label={t("common.loading")} />;
  if (rules.isError)
    return (
      <ErrorState
        message={(rules.error as Error).message}
        onRetry={() => rules.refetch()}
        retryLabel={t("common.retry")}
      />
    );

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("whatsapp.automations.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("whatsapp.automations.subtitle")}</p>
      </div>

      <p role="note" className="rounded-card border border-border bg-surface px-4 py-2.5 text-sm text-muted">
        {t("whatsapp.automations.serverNote")}
      </p>

      {savedNote ? (
        <p role="status" className="rounded-card bg-tint px-4 py-2 text-sm text-primary">
          {savedNote}
        </p>
      ) : null}

      {(rules.data ?? []).length === 0 && !rules.isPending ? (
        <EmptyState
          title={t("whatsapp.automations.title")}
          description={t("whatsapp.automations.serverNote")}
          icon={<BellRing size={18} aria-hidden="true" />}
        />
      ) : null}

      <ul className="flex flex-col gap-2">
        {EVENTS.map((event) => {
          const v = valueFor(event);
          return (
            <li
              key={event}
              className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">{eventLabel(event)}</p>
                  <p className="mt-0.5 text-xs text-muted">{eventDesc(event)}</p>
                </div>
                <label className="flex shrink-0 items-center gap-2 text-xs font-medium text-muted">
                  <span>{t("whatsapp.automations.active")}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={v.active}
                    aria-label={`${eventLabel(event)} — ${t("whatsapp.automations.active")}`}
                    onClick={() => patch(event, { active: !v.active })}
                    className={`relative h-6 w-11 rounded-full transition-colors ${v.active ? "bg-primary" : "bg-zinc-200"}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${v.active ? "left-[22px]" : "left-0.5"}`}
                    />
                  </button>
                </label>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <Select
                    aria-label={`${eventLabel(event)} — ${t("whatsapp.automations.templateSelect")}`}
                    value={v.templateId}
                    onChange={(e) => patch(event, { templateId: e.target.value })}
                    options={approved.map((tpl) => ({ value: tpl.id, label: tpl.name }))}
                    placeholder={t("whatsapp.automations.templateNone")}
                  />
                </div>
                <Button size="sm" onClick={() => save(event)} loading={saving === event}>
                  {t("whatsapp.automations.save")}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
