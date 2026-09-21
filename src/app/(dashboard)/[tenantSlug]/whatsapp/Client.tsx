"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MessageCircle, Search, Send, UserRound } from "lucide-react";
import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Select,
} from "@/components/ui";
import { ConversationList } from "@/components/domain/ConversationList";
import { WhatsAppThread } from "@/components/domain/WhatsAppThread";
import {
  useConversations,
  useSendTemplate,
  useSendText,
  useTemplates,
  useThread,
} from "@/hooks/useWhatsApp";
import { formatPhone255 } from "@/lib/format";
import { t } from "@/i18n";

const MAX_BODY = 1000;

export function WhatsAppClient({ tenantId }: { tenantId: string }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"OPEN" | "RESOLVED">("OPEN");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [assigned, setAssigned] = useState(false);
  const [resolvedLocal, setResolvedLocal] = useState<string[]>([]);

  const filters = useMemo(
    () => ({ search: search.trim() || undefined, status }),
    [search, status],
  );
  const conversations = useConversations(tenantId, filters);
  const thread = useThread(tenantId, selectedId);
  const templates = useTemplates(tenantId);
  const sendText = useSendText(tenantId);
  const sendTemplate = useSendTemplate(tenantId);

  const rows = useMemo(() => {
    const base = conversations.data?.rows ?? [];
    return status === "RESOLVED"
      ? base
      : base.filter((c) => !resolvedLocal.includes(c.id));
  }, [conversations.data, resolvedLocal, status]);

  const selected = useMemo(
    () => rows.find((c) => c.id === selectedId) ?? thread.data?.conversation ?? null,
    [rows, selectedId, thread.data],
  );

  const approvedTemplates = useMemo(
    () => (templates.data ?? []).filter((tpl) => tpl.status === "APPROVED"),
    [templates.data],
  );

  const sending = sendText.isPending || sendTemplate.isPending;

  const submitText = async () => {
    if (!selectedId || draft.trim().length === 0 || sending) return;
    setFeedback(null);
    try {
      await sendText.mutateAsync({ conversationId: selectedId, body: draft.trim() });
      setDraft("");
    } catch (e) {
      setFeedback((e as Error).message);
    }
  };

  const submitTemplate = async () => {
    if (!selectedId || !templateName || sending) return;
    setFeedback(null);
    try {
      await sendTemplate.mutateAsync({ conversationId: selectedId, templateName });
      setTemplateName("");
    } catch (e) {
      setFeedback((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">{t("whatsapp.inbox.title")}</h1>
        <div className="flex gap-2">
          <Link href={`/${tenantId}/whatsapp/templates`}>
            <Button variant="secondary" size="sm">
              {t("whatsapp.templates.title")}
            </Button>
          </Link>
          <Link href={`/${tenantId}/whatsapp/connect`}>
            <Button variant="secondary" size="sm">
              {t("whatsapp.connect.title")}
            </Button>
          </Link>
        </div>
      </div>

      {feedback ? (
        <p role="status" className="rounded-card bg-tint px-4 py-2 text-sm text-primary">
          {feedback}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[280px_minmax(0,1fr)_240px]">
        {/* Left: conversations */}
        <section aria-label={t("whatsapp.inbox.conversations")} className="overflow-hidden rounded-card border border-border bg-surface">
          <div className="flex flex-col gap-2 border-b border-border p-3">
            <Input
              aria-label={t("whatsapp.inbox.search")}
              placeholder={t("whatsapp.inbox.search")}
              icon={<Search size={18} aria-hidden="true" />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div role="group" aria-label={t("common.search")} className="flex gap-1 rounded-input bg-canvas p-1">
              {(["OPEN", "RESOLVED"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={status === s}
                  onClick={() => setStatus(s)}
                  className={`flex-1 rounded-input px-3 py-1.5 text-sm font-medium ${
                    status === s ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                  }`}
                >
                  {t(`whatsapp.inbox.filter${s === "OPEN" ? "Open" : "Resolved"}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[60dvh] overflow-y-auto lg:max-h-[70dvh]">
            {conversations.isPending ? (
              <div className="p-3"><LoadingState label={t("common.loading")} /></div>
            ) : conversations.isError ? (
              <div className="p-3">
                <ErrorState
                  message={(conversations.error as Error).message}
                  onRetry={() => conversations.refetch()}
                  retryLabel={t("common.retry")}
                />
              </div>
            ) : rows.length === 0 ? (
              <div className="p-3">
                <EmptyState
                  title={t("whatsapp.inbox.emptyTitle")}
                  description={t("whatsapp.inbox.emptyBody")}
                  icon={<MessageCircle size={18} aria-hidden="true" />}
                />
              </div>
            ) : (
              <ConversationList rows={rows} selectedId={selectedId} onSelect={setSelectedId} />
            )}
          </div>
        </section>

        {/* Center: thread + reply */}
        <section aria-label={t("whatsapp.inbox.title")} className="flex min-h-[50dvh] flex-col rounded-card border border-border bg-surface">
          {!selectedId || !selected ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState
                title={t("whatsapp.inbox.selectThread")}
                icon={<MessageCircle size={18} aria-hidden="true" />}
              />
            </div>
          ) : (
            <>
              <header className="border-b border-border px-4 py-3">
                <p className="text-sm font-semibold text-ink">
                  {selected.customerName?.trim() || selected.phoneE164}
                </p>
                <p className="text-xs tabular-nums text-muted">
                  {formatPhone255(selected.phoneE164)}
                </p>
              </header>
              <div className="flex-1 overflow-y-auto px-4 py-3">
                {thread.isPending ? (
                  <LoadingState label={t("common.loading")} />
                ) : thread.isError ? (
                  <ErrorState
                    message={(thread.error as Error).message}
                    onRetry={() => thread.refetch()}
                    retryLabel={t("common.retry")}
                  />
                ) : (thread.data?.messages ?? []).length === 0 ? (
                  <EmptyState
                    title={t("whatsapp.inbox.emptyTitle")}
                    description={t("whatsapp.inbox.emptyBody")}
                    icon={<MessageCircle size={18} aria-hidden="true" />}
                  />
                ) : (
                  <WhatsAppThread messages={thread.data?.messages ?? []} />
                )}
              </div>
              <footer className="flex flex-col gap-2 border-t border-border p-3">
                <label htmlFor="wa-reply" className="sr-only">
                  {t("whatsapp.inbox.replyPlaceholder")}
                </label>
                <textarea
                  id="wa-reply"
                  rows={2}
                  maxLength={MAX_BODY}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t("whatsapp.inbox.replyPlaceholder")}
                  className="w-full rounded-input border border-border bg-surface px-3.5 py-2.5 text-[15px] text-ink placeholder:text-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs tabular-nums text-faint" aria-live="polite">
                    {draft.length}/{MAX_BODY} {t("whatsapp.inbox.chars")}
                  </span>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <Select
                      aria-label={t("whatsapp.inbox.templatePicker")}
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      options={approvedTemplates.map((tpl) => ({ value: tpl.name, label: tpl.name }))}
                      placeholder={t("whatsapp.inbox.templateNone")}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={submitText} loading={sendText.isPending} disabled={draft.trim().length === 0 || sending}>
                      <Send size={18} aria-hidden="true" />
                      {t("whatsapp.inbox.send")}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={submitTemplate} loading={sendTemplate.isPending} disabled={!templateName || sending}>
                      {t("whatsapp.inbox.sendTemplate")}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted">{t("whatsapp.inbox.metaApprovalNote")}</p>
              </footer>
            </>
          )}
        </section>

        {/* Right: customer context */}
        <aside aria-label={t("whatsapp.inbox.customerContext")} className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
          {!selected ? (
            <EmptyState
              title={t("whatsapp.inbox.customerContext")}
              description={t("whatsapp.inbox.selectThread")}
              icon={<UserRound size={18} aria-hidden="true" />}
            />
          ) : (
            <>
              <div>
                <p className="text-sm font-semibold text-ink">
                  {selected.customerName?.trim() || formatPhone255(selected.phoneE164)}
                </p>
                <p className="text-xs tabular-nums text-muted">
                  {t("whatsapp.inbox.phone")}: {formatPhone255(selected.phoneE164)}
                </p>
                {selected.customerName?.trim() ? null : (
                  <p className="mt-1 text-xs text-muted">{t("whatsapp.inbox.notesEmpty")}</p>
                )}
              </div>
              <Link
                href={`/${tenantId}/customers`}
                className="text-sm font-medium text-primary underline-offset-2 hover:underline"
              >
                {t("whatsapp.inbox.viewCustomer")}
              </Link>
              <div>
                <p className="text-sm font-medium text-ink">{t("whatsapp.inbox.bookingsTitle")}</p>
                <p className="mt-1 text-xs text-muted">{t("whatsapp.inbox.bookingsEmpty")}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-ink">{t("whatsapp.inbox.notesTitle")}</p>
                <p className="mt-1 text-xs text-muted">{t("whatsapp.inbox.notesEmpty")}</p>
              </div>
              <div className="mt-auto flex flex-col gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setAssigned(true);
                    setFeedback(t("whatsapp.inbox.assigned"));
                  }}
                  disabled={assigned}
                >
                  {t("whatsapp.inbox.assignToMe")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (selectedId) setResolvedLocal((ids) => [...ids, selectedId]);
                    setSelectedId(null);
                    setFeedback(t("whatsapp.inbox.resolved"));
                  }}
                >
                  {t("whatsapp.inbox.resolve")}
                </Button>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
