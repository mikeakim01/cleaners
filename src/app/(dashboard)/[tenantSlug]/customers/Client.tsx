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
} from "@/components/ui";
import { useCustomers } from "@/hooks/useCustomers";
import { formatPhone255 } from "@/lib/format";
import { t } from "@/i18n";
import type { Customer } from "@/lib/trackf-types";

export function CustomersClient({
  tenantId,
  initial,
}: {
  tenantId: string;
  initial: Customer[];
}) {
  const { list, create } = useCustomers(tenantId);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [ward, setWard] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const rows = list.data ?? initial;

  const submit = async () => {
    setFeedback(null);
    try {
      await create.mutateAsync({ name, phone, ward: ward || undefined });
      setFeedback(t("customers.createSuccess"));
      setOpen(false);
      setName("");
      setPhone("");
      setWard("");
    } catch (e) {
      setFeedback((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t("customers.title")}</h1>
          <p className="text-sm text-muted">{t("customers.subtitle")}</p>
        </div>
        <Button className="ml-auto" size="sm" onClick={() => setOpen(true)}>
          {t("customers.addCustomer")}
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
        <EmptyState title={t("customers.emptyTitle")} description={t("customers.emptyBody")} />
      ) : (
        <DataTable<Customer>
          columns={[
            { key: "name", header: t("customers.name"), render: (r) => r.name },
            {
              key: "phone",
              header: t("customers.phone"),
              render: (r) => <span className="tabular-nums">{formatPhone255(r.phone)}</span>,
            },
            { key: "ward", header: t("customers.ward"), render: (r) => r.ward ?? "" },
            {
              key: "bookings",
              header: t("customers.bookings"),
              align: "right",
              render: (r) => <span className="tabular-nums">{r.bookingsCount ?? 0}</span>,
            },
            {
              key: "spent",
              header: t("customers.totalSpent"),
              align: "right",
              render: (r) => (
                <Currency amountMinor={r.totalSpentMinor ?? 0} currency={r.currency ?? "TZS"} />
              ),
            },
          ]}
          rows={rows}
          getRowKey={(r) => r.id}
        />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={t("customers.addCustomer")}>
        <div className="flex flex-col gap-3">
          <Input label={t("customers.name")} value={name} onChange={(e) => setName(e.target.value)} />
          <Input label={t("customers.phone")} value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Input label={t("customers.ward")} value={ward} onChange={(e) => setWard(e.target.value)} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} loading={create.isPending} disabled={!name.trim() || !phone.trim()}>
            {t("common.save")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
