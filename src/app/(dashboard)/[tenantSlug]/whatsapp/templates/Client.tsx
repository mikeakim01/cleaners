"use client";

import { useMemo, useState } from "react";
import { FileText, Plus, RefreshCw } from "lucide-react";
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  Select,
  StatusBadge,
} from "@/components/ui";
import type { StatusKind } from "@/components/ui/StatusBadge";
import { useTemplates } from "@/hooks/useWhatsApp";
import { t } from "@/i18n";

const KIND_BY_STATUS: Record<string, StatusKind> = {
  APPROVED: "success",
  PENDING: "warning",
  REJECTED: "danger",
};

const STATUS_LABEL: Record<string, string> = {
  APPROVED: "whatsapp.templates.statusApproved",
  PENDING: "whatsapp.templates.statusPending",
  REJECTED: "whatsapp.templates.statusRejected",
};

const SOURCE_FIELDS = [
  "booking.reference",
  "customer.full_name",
  "invoice.total",
  "job.status",
];

interface MappingRow {
  key: number;
  position: string;
  source: string;
}

export function TemplatesClient({ tenantId }: { tenantId: string }) {
  const templates = useTemplates(tenantId);
  const [modalOpen, setModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en");
  const [category, setCategory] = useState("UTILITY");
  const [body, setBody] = useState("");
  const [mappings, setMappings] = useState<MappingRow[]>([{ key: 1, position: "1", source: "customer.full_name" }]);

  const rows = useMemo(() => templates.data ?? [], [templates.data]);

  const insertPlaceholder = () => {
    const placeholders = Array.from(body.matchAll(/\{\{(\d+)\}\}/g)).map((m) => Number(m[1]));
    const next = placeholders.length > 0 ? Math.max(...placeholders) + 1 : 1;
    setBody((b) => `${b}{{${next}}}`);
  };

  const patchMapping = (key: number, p: Partial<MappingRow>) =>
    setMappings((ms) => ms.map((m) => (m.key === key ? { ...m, ...p } : m)));

  const addMapping = () =>
    setMappings((ms) => [
      ...ms,
      { key: Math.max(0, ...ms.map((m) => m.key)) + 1, position: String(ms.length + 1), source: SOURCE_FIELDS[0] ?? "" },
    ]);

  const removeMapping = (key: number) =>
    setMappings((ms) => (ms.length > 1 ? ms.filter((m) => m.key !== key) : ms));

  const submit = async () => {
    setFeedback(null);
    if (!name.trim() || !body.trim()) {
      setFeedback(t("common.required"));
      return;
    }
    try {
      const variables = mappings
        .map((m) => m.source.trim())
        .filter((s) => s.length > 0);
      await templates.create.mutateAsync({
        name: name.trim(),
        language,
        category,
        body: body.trim(),
        variables,
      });
      setFeedback(t("whatsapp.templates.createSuccess"));
      setModalOpen(false);
      setName("");
      setBody("");
    } catch (e) {
      setFeedback((e as Error).message);
    }
  };

  const sync = async () => {
    setFeedback(null);
    try {
      await templates.sync.mutateAsync();
      setFeedback(t("whatsapp.templates.syncSuccess"));
    } catch (e) {
      setFeedback((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t("whatsapp.templates.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("whatsapp.templates.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={sync} loading={templates.sync.isPending}>
            <RefreshCw size={18} aria-hidden="true" />
            {t("whatsapp.templates.sync")}
          </Button>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus size={18} aria-hidden="true" />
            {t("whatsapp.templates.newTemplate")}
          </Button>
        </div>
      </div>

      <p role="note" className="rounded-card border border-warning/20 bg-amber-50 px-4 py-2.5 text-sm text-ink">
        {t("whatsapp.templates.approvalBanner")}
      </p>

      {feedback ? (
        <p role="status" className="rounded-card bg-tint px-4 py-2 text-sm text-primary">
          {feedback}
        </p>
      ) : null}

      {templates.isPending ? (
        <LoadingState label={t("common.loading")} />
      ) : templates.isError ? (
        <ErrorState
          message={(templates.error as Error).message}
          onRetry={() => templates.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t("whatsapp.templates.emptyTitle")}
          description={t("whatsapp.templates.emptyBody")}
          icon={<FileText size={18} aria-hidden="true" />}
          action={
            <Button size="sm" onClick={() => setModalOpen(true)}>
              {t("whatsapp.templates.newTemplate")}
            </Button>
          }
        />
      ) : (
        <DataTable
          columns={[
            { key: "name", header: t("whatsapp.templates.colName"), render: (row) => <span className="font-semibold">{row.name}</span> },
            { key: "language", header: t("whatsapp.templates.colLanguage"), render: (row) => row.language },
            { key: "category", header: t("whatsapp.templates.colCategory"), render: (row) => row.category },
            {
              key: "body",
              header: t("whatsapp.templates.colBody"),
              render: (row) => <span className="line-clamp-2 block max-w-md whitespace-pre-wrap">{row.body}</span>,
            },
            {
              key: "variables",
              header: t("whatsapp.templates.colVariables"),
              render: (row) => (row.variables.length > 0 ? row.variables.join(", ") : "—"),
            },
            {
              key: "status",
              header: t("whatsapp.templates.colStatus"),
              render: (row) => (
                <StatusBadge
                  status={KIND_BY_STATUS[row.status] ?? "pending"}
                  label={t((STATUS_LABEL[row.status] ?? "whatsapp.templates.statusPending") as Parameters<typeof t>[0])}
                />
              ),
            },
          ]}
          rows={rows}
          getRowKey={(row) => row.id}
        />
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t("whatsapp.templates.newTemplate")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={submit} loading={templates.create.isPending}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            label={t("whatsapp.templates.fieldName")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="booking_confirmation"
          />
          <div className="grid grid-cols-2 gap-2">
            <Select
              label={t("whatsapp.templates.fieldLanguage")}
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              options={[
                { value: "en", label: "English (en)" },
                { value: "sw", label: "Kiswahili (sw)" },
              ]}
            />
            <Select
              label={t("whatsapp.templates.fieldCategory")}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              options={["UTILITY", "MARKETING", "AUTHENTICATION"].map((c) => ({ value: c, label: c }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="wa-tpl-body" className="text-sm font-medium text-ink">
              {t("whatsapp.templates.fieldBody")}
            </label>
            <textarea
              id="wa-tpl-body"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Hello {{1}}, your booking {{2}} is confirmed."
              className="w-full rounded-input border border-border bg-surface px-3.5 py-2.5 text-[15px] text-ink placeholder:text-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="text-xs text-muted">{t("whatsapp.templates.bodyHint")}</p>
            <div>
              <Button variant="secondary" size="sm" onClick={insertPlaceholder}>
                <Plus size={18} aria-hidden="true" />
                {t("whatsapp.templates.insertVariable")}
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-ink">{t("whatsapp.templates.variableMapping")}</p>
            {mappings.map((m) => (
              <div key={m.key} className="grid grid-cols-12 items-end gap-2">
                <div className="col-span-3">
                  <Input
                    aria-label={t("whatsapp.templates.variablePosition")}
                    value={m.position}
                    onChange={(e) => patchMapping(m.key, { position: e.target.value })}
                    inputMode="numeric"
                  />
                </div>
                <div className="col-span-7">
                  <Select
                    aria-label={t("whatsapp.templates.variableSource")}
                    value={m.source}
                    onChange={(e) => patchMapping(m.key, { source: e.target.value })}
                    options={SOURCE_FIELDS.map((f) => ({ value: f, label: f }))}
                  />
                </div>
                <div className="col-span-2">
                  <Button variant="ghost" size="sm" aria-label={t("common.cancel")} onClick={() => removeMapping(m.key)}>
                    ×
                  </Button>
                </div>
              </div>
            ))}
            <div>
              <Button variant="secondary" size="sm" onClick={addMapping}>
                <Plus size={18} aria-hidden="true" />
                {t("whatsapp.templates.addMapping")}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
