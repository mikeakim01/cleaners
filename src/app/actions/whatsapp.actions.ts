"use server";

import { AppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { resolveTenant, TenantAccessDeniedError } from "@/server/tenant-context";
import { PermissionDeniedError } from "@/rbac/permissions";
import { requirePermission } from "@/services/rbac.service";
import {
  connectAccount,
  createTemplate,
  disconnectAccount,
  getAccount,
  getThread,
  listConversations,
  listTemplates,
  resolveConversation,
  sendTemplateMessage,
  sendTextMessage,
  syncTemplates,
  testConnection,
  updateTemplate,
} from "@/services/whatsapp.service";
import { listRules, upsertRule } from "@/services/whatsapp-automations.service";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function toError(err: unknown): string {
  if (err instanceof AppError) return err.message;
  if (err instanceof TenantAccessDeniedError) return "You do not have access to this business.";
  if (err instanceof PermissionDeniedError) return "You do not have permission to do that. Ask your manager for access.";
  if (err instanceof Error) return err.message || "Something went wrong. Please try again.";
  return "Something went wrong. Please try again.";
}

async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new AppError("Please sign in to continue.");
  return user.id;
}

export async function connectAccountAction(
  tenantId: string,
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof connectAccount>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "whatsapp:connect");
    const data = await connectAccount(ctx.tenantId, userId, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function getAccountAction(
  tenantId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof getAccount>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "whatsapp:read");
    const data = await getAccount(ctx.tenantId, userId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function testConnectionAction(
  tenantId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof testConnection>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "whatsapp:read");
    const data = await testConnection(ctx.tenantId, userId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function disconnectAccountAction(
  tenantId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof disconnectAccount>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "whatsapp:connect");
    const data = await disconnectAccount(ctx.tenantId, userId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function sendTextAction(
  tenantId: string,
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof sendTextMessage>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "whatsapp:send");
    const data = await sendTextMessage(ctx.tenantId, userId, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function sendTemplateAction(
  tenantId: string,
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof sendTemplateMessage>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "whatsapp:send");
    const data = await sendTemplateMessage(ctx.tenantId, userId, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function listConversationsAction(
  tenantId: string,
  filter: unknown = {},
): Promise<ActionResult<Awaited<ReturnType<typeof listConversations>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "whatsapp:read");
    const data = await listConversations(ctx.tenantId, userId, filter);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function getThreadAction(
  tenantId: string,
  conversationId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof getThread>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "whatsapp:read");
    const data = await getThread(ctx.tenantId, userId, conversationId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function resolveConversationAction(
  tenantId: string,
  phone: string,
): Promise<ActionResult<Awaited<ReturnType<typeof resolveConversation>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "whatsapp:read");
    const data = await resolveConversation(ctx.tenantId, phone, null);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function listTemplatesAction(
  tenantId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof listTemplates>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "whatsapp:read");
    const data = await listTemplates(ctx.tenantId, userId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function createTemplateAction(
  tenantId: string,
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof createTemplate>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "whatsapp:templates");
    const data = await createTemplate(ctx.tenantId, userId, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function updateTemplateAction(
  tenantId: string,
  templateId: string,
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof updateTemplate>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "whatsapp:templates");
    const data = await updateTemplate(ctx.tenantId, userId, templateId, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function syncTemplatesAction(
  tenantId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof syncTemplates>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "whatsapp:templates");
    const data = await syncTemplates(ctx.tenantId, userId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function listRulesAction(
  tenantId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof listRules>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "whatsapp:read");
    const data = await listRules(ctx.tenantId, userId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function upsertRuleAction(
  tenantId: string,
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof upsertRule>>>> {
  try {
    const userId = await requireUserId();
    const ctx = await resolveTenant({ userId, requestedTenantId: tenantId });
    await requirePermission(ctx.tenantId, userId, "whatsapp:templates");
    const data = await upsertRule(ctx.tenantId, userId, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}
