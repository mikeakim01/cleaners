"use client";

import { useState } from "react";
import {
  Avatar,
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
import { useEmployees } from "@/hooks/useEmployees";
import { useTeams } from "@/hooks/useTeams";
import { formatPhone255 } from "@/lib/format";
import { t } from "@/i18n";
import type { Employee } from "@/lib/trackf-types";

export function EmployeesClient({
  tenantId,
  initial,
}: {
  tenantId: string;
  initial: Employee[];
}) {
  const { list, create } = useEmployees(tenantId);
  const { teams } = useTeams(tenantId);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");
  const [teamId, setTeamId] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const rows = list.data ?? initial;

  const submit = async () => {
    setFeedback(null);
    try {
      await create.mutateAsync({
        name,
        phone: phone || undefined,
        role: role || undefined,
        teamId: teamId || undefined,
      });
      setFeedback(t("employees.createSuccess"));
      setOpen(false);
      setName("");
      setPhone("");
      setRole("");
      setTeamId("");
    } catch (e) {
      setFeedback((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t("employees.title")}</h1>
          <p className="text-sm text-muted">{t("employees.subtitle")}</p>
        </div>
        <Button className="ml-auto" size="sm" onClick={() => setOpen(true)}>
          {t("employees.addEmployee")}
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
        <EmptyState title={t("employees.emptyTitle")} description={t("employees.emptyBody")} />
      ) : (
        <DataTable<Employee>
          columns={[
            {
              key: "name",
              header: t("employees.name"),
              render: (r) => (
                <span className="flex items-center gap-2">
                  <Avatar name={r.name} src={r.avatarUrl} size="sm" />
                  <span className="font-medium">{r.name}</span>
                </span>
              ),
            },
            {
              key: "phone",
              header: t("employees.phone"),
              render: (r) => (
                <span className="tabular-nums">{r.phone ? formatPhone255(r.phone) : ""}</span>
              ),
            },
            { key: "role", header: t("employees.role"), render: (r) => r.role ?? "" },
            { key: "team", header: t("employees.team"), render: (r) => r.teamName ?? "" },
            {
              key: "status",
              header: t("employees.status"),
              render: (r) => (
                <StatusBadge
                  status={r.active === false ? "pending" : "success"}
                  label={r.active === false ? t("employees.inactive") : t("employees.active")}
                />
              ),
            },
          ]}
          rows={rows}
          getRowKey={(r) => r.id}
        />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={t("employees.addEmployee")}>
        <div className="flex flex-col gap-3">
          <Input label={t("employees.name")} value={name} onChange={(e) => setName(e.target.value)} />
          <Input label={t("employees.phone")} value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Input label={t("employees.role")} value={role} onChange={(e) => setRole(e.target.value)} />
          <Select
            label={t("employees.team")}
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            options={teams.map((tm) => ({ value: tm.id, label: tm.name }))}
            placeholder={t("teams.selectTeam")}
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
