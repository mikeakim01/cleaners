"use client";

import { useState } from "react";
import {
  Button,
  Currency,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  StatusBadge,
} from "@/components/ui";
import { useCatalog } from "@/hooks/useCatalog";
import { t } from "@/i18n";
import type { ServiceItem } from "@/lib/trackf-types";

export function ServicesClient({
  tenantId,
  initial,
}: {
  tenantId: string;
  initial: ServiceItem[];
}) {
  const { list, create } = useCatalog(tenantId);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [base, setBase] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const rows = list.data ?? initial;

  const submit = async () => {
    setFeedback(null);
    try {
      await create.mutateAsync({
        name,
        pricingModel: model,
        baseMinor: Number(base) || 0,
      });
      setFeedback(t("services.createSuccess"));
      setOpen(false);
      setName("");
      setModel("");
      setBase("");
    } catch (e) {
      setFeedback((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t("services.title")}</h1>
          <p className="text-sm text-muted">{t("services.subtitle")}</p>
        </div>
        <Button className="ml-auto" size="sm" onClick={() => setOpen(true)}>
          {t("services.addService")}
        </Button>
      </div>

      {feedback ? (
        <p role="status" className="rounded-card bg-tint px-4 py-2 text-sm text-primary">
          {feedback}
        </p>
      ) : null}

      {list.isPending && rows.length === 0 ? (
        <LoadingState label={t("common.loading")} />
      ) : list.isError && rows.length === 0 ? (
        <ErrorState
          message={(list.error as Error).message}
          onRetry={() => list.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : rows.length === 0 ? (
        <EmptyState title={t("services.emptyTitle")} description={t("services.emptyBody")} />
      ) : (
        <DataTable<ServiceItem>
          columns={[
            { key: "name", header: t("services.colName"), render: (r) => r.name },
            {
              key: "model",
              header: t("services.colModel"),
              render: (r) => <StatusBadge status="info" label={r.pricingModel} />,
            },
            {
              key: "base",
              header: t("services.colPrice"),
              align: "right",
              render: (r) => (
                <Currency amountMinor={r.baseMinor} currency={r.currency ?? "TZS"} />
              ),
            },
            {
              key: "unit",
              header: t("services.colUnit"),
              align: "right",
              render: (r) =>
                r.unitMinor != null ? (
                  <span>
                    <Currency amountMinor={r.unitMinor} currency={r.currency ?? "TZS"} />{" "}
                    <span className="text-xs text-muted">
                      {t("services.perUnit")} {r.unitLabel ?? ""}
                    </span>
                  </span>
                ) : (
                  ""
                ),
            },
            {
              key: "status",
              header: t("services.status"),
              render: (r) => (
                <StatusBadge
                  status={r.active === false ? "pending" : "success"}
                  label={r.active === false ? t("services.inactive") : t("services.active")}
                />
              ),
            },
          ]}
          rows={rows}
          getRowKey={(r) => r.id}
        />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={t("services.addService")}>
        <div className="flex flex-col gap-3">
          <Input label={t("services.name")} value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            label={t("services.pricingModel")}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
          <Input
            label={t("services.basePrice")}
            inputMode="numeric"
            value={base}
            onChange={(e) => setBase(e.target.value)}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} loading={create.isPending} disabled={!name.trim()}>
            {t("common.save")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
