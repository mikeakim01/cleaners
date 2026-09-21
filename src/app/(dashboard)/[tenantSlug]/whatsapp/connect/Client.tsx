"use client";

import { useState } from "react";
import { Cable, Copy, PlugZap, Unplug } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  StatusBadge,
} from "@/components/ui";
import type { StatusKind } from "@/components/ui/StatusBadge";
import { useConnectAccount, useWhatsAppAccount } from "@/hooks/useWhatsApp";
import { formatDate, formatPhone255 } from "@/lib/format";
import { t } from "@/i18n";

const KIND_BY_STATUS: Record<string, StatusKind> = {
  CONNECTED: "success",
  PENDING: "warning",
  DISCONNECTED: "pending",
  ERROR: "danger",
};

export function ConnectClient({ tenantId }: { tenantId: string }) {
  const account = useWhatsAppAccount(tenantId);
  const connect = useConnectAccount(tenantId);

  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [token, setToken] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const data = account.data ?? null;
  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/webhooks/whatsapp`;

  const submit = async () => {
    setFormError(null);
    setFeedback(null);
    if (!phoneNumberId.trim() || !wabaId.trim() || !token.trim()) {
      setFormError(t("common.required"));
      return;
    }
    try {
      await connect.mutateAsync({
        phoneNumberId: phoneNumberId.trim(),
        wabaId: wabaId.trim(),
        displayName: displayName.trim() || undefined,
        accessToken: token,
      });
      setToken("");
      setFeedback(t("whatsapp.connect.connectSuccess"));
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  const runTest = async () => {
    setFeedback(null);
    try {
      await account.test.mutateAsync();
      setFeedback(t("whatsapp.connect.testSuccess"));
    } catch (e) {
      setFeedback((e as Error).message);
    }
  };

  const runDisconnect = async () => {
    setFeedback(null);
    try {
      await account.disconnect.mutateAsync();
      setConfirmOpen(false);
      setFeedback(t("whatsapp.connect.disconnectSuccess"));
    } catch (e) {
      setFeedback((e as Error).message);
    }
  };

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setFeedback(t("whatsapp.connect.copied"));
    } catch {
      setFeedback(webhookUrl);
    }
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("whatsapp.connect.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("whatsapp.connect.subtitle")}</p>
      </div>

      {feedback ? (
        <p role="status" className="break-all rounded-card bg-tint px-4 py-2 text-sm text-primary">
          {feedback}
        </p>
      ) : null}

      {account.isPending ? (
        <LoadingState label={t("common.loading")} />
      ) : account.isError ? (
        <ErrorState
          message={(account.error as Error).message}
          onRetry={() => account.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : !data ? (
        <EmptyState
          title={t("whatsapp.connect.statusDisconnected")}
          description={t("whatsapp.connect.subtitle")}
          icon={<Cable size={18} aria-hidden="true" />}
        />
      ) : (
        <section aria-label={t("whatsapp.connect.title")} className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <StatusBadge
              status={KIND_BY_STATUS[data.status] ?? "pending"}
              label={t(`whatsapp.connect.status${data.status === "CONNECTED" ? "Connected" : data.status === "PENDING" ? "Pending" : data.status === "ERROR" ? "Error" : "Disconnected"}`)}
            />
            <span className={`text-xs font-medium ${data.hasToken ? "text-success" : "text-warning"}`}>
              {data.hasToken ? t("whatsapp.connect.tokenConfigured") : t("whatsapp.connect.tokenMissing")}
            </span>
          </div>
          <dl className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted">{t("whatsapp.connect.displayName")}</dt>
              <dd className="font-medium text-ink">{data.displayName || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t("whatsapp.connect.phone")}</dt>
              <dd className="font-medium tabular-nums text-ink">
                {data.phone ? formatPhone255(data.phone) : "—"}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted">{t("whatsapp.connect.lastTested")}</dt>
              <dd className="font-medium tabular-nums text-ink">
                {data.lastTestedAt ? formatDate(data.lastTestedAt) : t("whatsapp.connect.neverTested")}
              </dd>
            </div>
          </dl>
          <div className="mt-1 flex gap-2">
            <Button size="sm" variant="secondary" onClick={runTest} loading={account.test.isPending}>
              <PlugZap size={18} aria-hidden="true" />
              {t("whatsapp.connect.test")}
            </Button>
            <Button size="sm" variant="danger" onClick={() => setConfirmOpen(true)}>
              <Unplug size={18} aria-hidden="true" />
              {t("whatsapp.connect.disconnect")}
            </Button>
          </div>
        </section>
      )}

      <section aria-label={t("whatsapp.connect.connect")} className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
        <h2 className="font-heading text-base font-semibold">{t("whatsapp.connect.connect")}</h2>
        <Input
          label={t("whatsapp.connect.fieldPhoneNumberId")}
          value={phoneNumberId}
          onChange={(e) => setPhoneNumberId(e.target.value)}
          placeholder="123456789012345"
          inputMode="numeric"
        />
        <Input
          label={t("whatsapp.connect.fieldWabaId")}
          value={wabaId}
          onChange={(e) => setWabaId(e.target.value)}
          placeholder="123456789012345"
          inputMode="numeric"
        />
        <Input
          label={t("whatsapp.connect.fieldDisplayName")}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <Input
          label={t("whatsapp.connect.fieldToken")}
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          hint={t("whatsapp.connect.tokenMissing")}
          autoComplete="off"
        />
        {formError ? (
          <p role="alert" className="text-sm text-danger">{formError}</p>
        ) : null}
        <div>
          <Button onClick={submit} loading={connect.isPending}>
            <Cable size={18} aria-hidden="true" />
            {t("whatsapp.connect.connect")}
          </Button>
        </div>
      </section>

      <section aria-label={t("whatsapp.connect.webhookTitle")} className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4">
        <h2 className="font-heading text-base font-semibold">{t("whatsapp.connect.webhookTitle")}</h2>
        <p className="text-xs text-muted">{t("whatsapp.connect.webhookHint")}</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-input bg-canvas px-3 py-2 text-xs tabular-nums text-ink">
            {webhookUrl}
          </code>
          <Button variant="secondary" size="sm" onClick={copyWebhook}>
            <Copy size={18} aria-hidden="true" />
            {t("whatsapp.connect.copy")}
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={confirmOpen}
        title={t("whatsapp.connect.disconnectTitle")}
        message={t("whatsapp.connect.disconnectBody")}
        confirmLabel={t("whatsapp.connect.disconnectConfirm")}
        cancelLabel={t("common.cancel")}
        danger
        loading={account.disconnect.isPending}
        onConfirm={runDisconnect}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
