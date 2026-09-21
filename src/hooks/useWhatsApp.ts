"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  WaAutomationRule,
  WaConnectInput,
  WaConversation,
  WaConversationFilters,
  WaCreateTemplateInput,
  WaMessage,
  WaTemplate,
  WaUpdateTemplateInput,
  WaUpsertRuleInput,
} from "@/lib/wa-types";
import {
  mapAccount,
  mapConversation,
  mapMessage,
  mapRule,
  mapTemplate,
  toServiceVariables,
} from "@/lib/wa-mappers";
import {
  connectAccountAction,
  createTemplateAction,
  disconnectAccountAction,
  getAccountAction,
  getThreadAction,
  listConversationsAction,
  listRulesAction,
  listTemplatesAction,
  sendTemplateAction,
  sendTextAction,
  syncTemplatesAction,
  testConnectionAction,
  updateTemplateAction,
  upsertRuleAction,
} from "@/app/actions/whatsapp.actions";

function unwrap<T>(res: { ok: boolean; data?: T; error?: string }, fallback: string): T {
  if (res.ok) return (res as { ok: true; data: T }).data;
  throw new Error((res as { ok: false; error: string }).error || fallback);
}

/** Account status card: current account + test/disconnect mutations. */
export function useWhatsAppAccount(tenantId: string) {
  const query = useQuery({
    queryKey: ["whatsapp", "account", tenantId],
    queryFn: async () => {
      const account = unwrap(await getAccountAction(tenantId), "Could not load WhatsApp account.");
      return account ? mapAccount(account) : null;
    },
    enabled: tenantId.length > 0,
    staleTime: 15_000,
  });

  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: ["whatsapp", "account", tenantId] });

  const test = useMutation({
    mutationFn: async () => {
      const account = unwrap(await testConnectionAction(tenantId), "Connection test failed.");
      return mapAccount(account);
    },
    onSuccess: () => {
      void invalidate();
    },
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      await unwrap(await disconnectAccountAction(tenantId), "Could not disconnect.");
    },
    onSuccess: () => {
      void invalidate();
    },
  });

  return { ...query, test, disconnect };
}

/** Connect form mutation (phone_number_id / waba_id / display name / token). */
export function useConnectAccount(tenantId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: WaConnectInput) => {
      const account = unwrap(
        await connectAccountAction(tenantId, {
          phoneNumberId: input.phoneNumberId,
          wabaId: input.wabaId,
          displayName: input.displayName ?? "",
          accessToken: input.accessToken,
        }),
        "Could not connect WhatsApp account.",
      );
      return mapAccount(account);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["whatsapp", "account", tenantId] });
    },
  });
}

/**
 * Conversation list with 8s polling.
 * Polling (instead of Supabase Realtime) because RLS session GUCs are
 * incompatible with the anon Realtime channel, so all reads go through
 * server actions + interval refetch.
 */
export function useConversations(tenantId: string, filters: WaConversationFilters) {
  return useQuery({
    queryKey: ["whatsapp", "conversations", tenantId, filters],
    queryFn: async (): Promise<{ rows: WaConversation[]; total: number }> => {
      const rows = unwrap(
        await listConversationsAction(tenantId, filters.status ? { status: filters.status } : {}),
        "Could not load conversations.",
      ).map(mapConversation);
      const q = (filters.search ?? "").trim().toLowerCase();
      const filtered =
        q.length > 0
          ? rows.filter(
              (c) =>
                c.phoneE164.toLowerCase().includes(q) ||
                (c.customerName ?? "").toLowerCase().includes(q) ||
                (c.lastBody ?? "").toLowerCase().includes(q),
            )
          : rows;
      return { rows: filtered, total: filtered.length };
    },
    enabled: tenantId.length > 0,
    refetchInterval: 8_000,
    staleTime: 5_000,
  });
}

/** Single thread with 5s polling (see useConversations for why polling). */
export function useThread(tenantId: string, conversationId: string | null) {
  return useQuery({
    queryKey: ["whatsapp", "thread", tenantId, conversationId],
    queryFn: async () => {
      const thread = unwrap(
        await getThreadAction(tenantId, conversationId ?? ""),
        "Could not load messages.",
      );
      return {
        conversation: mapConversation(thread.conversation),
        messages: thread.messages.map(mapMessage),
      };
    },
    enabled: tenantId.length > 0 && (conversationId ?? "").length > 0,
    refetchInterval: 5_000,
    staleTime: 3_000,
  });
}

function useInvalidateThread(tenantId: string) {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ["whatsapp", "thread", tenantId] });
    void client.invalidateQueries({ queryKey: ["whatsapp", "conversations", tenantId] });
  };
}

/** Free-text reply inside the 24h window. Invalidates thread + list. */
export function useSendText(tenantId: string) {
  const invalidate = useInvalidateThread(tenantId);
  return useMutation({
    mutationFn: async (input: { conversationId: string; body: string }): Promise<WaMessage> =>
      mapMessage(
        unwrap(await sendTextAction(tenantId, input), "Could not send message."),
      ),
    onSuccess: () => invalidate(),
  });
}

/** Approved-template send (outside the 24h window). Invalidates thread + list. */
export function useSendTemplate(tenantId: string) {
  const invalidate = useInvalidateThread(tenantId);
  return useMutation({
    mutationFn: async (input: { conversationId: string; templateName: string }): Promise<WaMessage> =>
      mapMessage(
        unwrap(await sendTemplateAction(tenantId, input), "Could not send template."),
      ),
    onSuccess: () => invalidate(),
  });
}

/** Template library: list / create / status-or-variables update / sync from Meta. */
export function useTemplates(tenantId: string) {
  const query = useQuery({
    queryKey: ["whatsapp", "templates", tenantId],
    queryFn: async (): Promise<WaTemplate[]> =>
      unwrap(await listTemplatesAction(tenantId), "Could not load templates.").map(mapTemplate),
    enabled: tenantId.length > 0,
    staleTime: 15_000,
  });

  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: ["whatsapp", "templates", tenantId] });

  const create = useMutation({
    mutationFn: async (input: WaCreateTemplateInput): Promise<WaTemplate> =>
      mapTemplate(
        unwrap(
          await createTemplateAction(tenantId, {
            name: input.name,
            language: input.language,
            category: input.category,
            body: input.body,
            variables: toServiceVariables(input.variables),
          }),
          "Could not create template.",
        ),
      ),
    onSuccess: () => invalidate(),
  });

  const update = useMutation({
    mutationFn: async (input: WaUpdateTemplateInput): Promise<WaTemplate> =>
      mapTemplate(
        unwrap(
          await updateTemplateAction(tenantId, input.id, {
            ...(input.status ? { status: input.status } : {}),
            ...(input.variables
              ? { variables: toServiceVariables(input.variables) }
              : {}),
          }),
          "Could not update template.",
        ),
      ),
    onSuccess: () => invalidate(),
  });

  const sync = useMutation({
    mutationFn: async (): Promise<{ synced: number; message: string }> =>
      unwrap(await syncTemplatesAction(tenantId), "Could not sync templates."),
    onSuccess: () => invalidate(),
  });

  return { ...query, create, update, sync };
}

/** Automation rules: event -> template mapping, saved per row. */
export function useAutomationRules(tenantId: string) {
  const query = useQuery({
    queryKey: ["whatsapp", "rules", tenantId],
    queryFn: async (): Promise<WaAutomationRule[]> =>
      unwrap(await listRulesAction(tenantId), "Could not load automation rules.").map(mapRule),
    enabled: tenantId.length > 0,
    staleTime: 15_000,
  });

  const client = useQueryClient();

  const upsert = useMutation({
    mutationFn: async (input: WaUpsertRuleInput): Promise<WaAutomationRule> =>
      mapRule(unwrap(await upsertRuleAction(tenantId, input), "Could not save rule.")),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["whatsapp", "rules", tenantId] });
    },
  });

  return { ...query, upsert };
}
