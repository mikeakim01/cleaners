import 'server-only';

import { z } from 'zod';

import { AppError } from '@/lib/errors';

/** Meta Graph API version used for all WhatsApp Cloud API calls. */
export const API_VERSION: string =
  process.env.WHATSAPP_API_VERSION || 'v18.0';

const REQUEST_TIMEOUT_MS = 15_000;

const phoneNumberIdSchema = z.string().min(1, 'Phone number ID is required.');
const tokenSchema = z.string().min(1, 'Access token is required.');
const recipientSchema = z
  .string()
  .min(1, 'Recipient phone number is required.')
  // E.164-ish: optional leading +, 7–15 digits.
  .regex(/^\+?[1-9]\d{6,14}$/, 'Recipient must be a valid phone number.');

const sendTextInputSchema = z.object({
  phoneNumberId: phoneNumberIdSchema,
  token: tokenSchema,
  to: recipientSchema,
  body: z.string().min(1, 'Message body is required.').max(4096),
});

const sendTemplateInputSchema = z.object({
  phoneNumberId: phoneNumberIdSchema,
  token: tokenSchema,
  to: recipientSchema,
  templateName: z.string().min(1, 'Template name is required.'),
  language: z.string().min(2).max(16).default('en'),
  templateParams: z.array(z.string().max(1024)).max(20).default([]),
});

const businessProfileInputSchema = z.object({
  phoneNumberId: phoneNumberIdSchema,
  token: tokenSchema,
});

const markReadInputSchema = z.object({
  phoneNumberId: phoneNumberIdSchema,
  token: tokenSchema,
  messageId: z.string().min(1, 'Message ID is required.'),
});

export type SendTextInput = z.input<typeof sendTextInputSchema>;
export type SendTemplateInput = z.input<typeof sendTemplateInputSchema>;
export type BusinessProfileInput = z.input<
  typeof businessProfileInputSchema
>;
export type MarkReadInput = z.input<typeof markReadInputSchema>;

export interface TextPayload {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'text';
  text: { preview_url: boolean; body: string };
}

export interface TemplatePayload {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'template';
  template: {
    name: string;
    language: { code: string };
    components: Array<{
      type: 'body';
      parameters: Array<{ type: 'text'; text: string }>;
    }>;
  };
}

export interface BusinessProfile {
  verified_name: string | null;
  display_phone_number: string | null;
}

/** Pure builder for a free-form text message request body. */
export function buildTextPayload(to: string, body: string): TextPayload {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body },
  };
}

/** Pure builder for a template message request body. */
export function buildTemplatePayload(
  to: string,
  name: string,
  language: string,
  params: string[],
): TemplatePayload {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name,
      language: { code: language },
      components:
        params.length > 0
          ? [
              {
                type: 'body',
                parameters: params.map((text) => ({ type: 'text', text })),
              },
            ]
          : [],
    },
  };
}

type FetchImpl = typeof fetch;

function messagesUrl(phoneNumberId: string): string {
  return `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/messages`;
}

/** Extracts a human-readable detail from a Meta error body without leaking secrets. */
async function readErrorDetail(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json();
    if (typeof data === 'object' && data !== null && 'error' in data) {
      const err = (data as { error: unknown }).error;
      if (typeof err === 'object' && err !== null && 'message' in err) {
        const message = (err as { message: unknown }).message;
        if (typeof message === 'string' && message.trim() !== '') {
          return message;
        }
      }
    }
  } catch {
    // Fall through to the generic status-based message below.
  }
  return `Request failed with status ${response.status}.`;
}

function toAppError(response: Response, detail: string): AppError {
  const base = `WhatsApp rejected the message: ${detail}`;
  if (response.status === 401 || response.status === 403) {
    return new AppError(`${base} Check the access token.`);
  }
  if (response.status === 404) {
    return new AppError(`${base} Check the phone number ID.`);
  }
  return new AppError(base);
}

/** Wraps a Graph call with a timeout; maps transport failures to AppError. Never includes the token. */
async function postJson(
  url: string,
  token: string,
  payload: unknown,
  fetchImpl: FetchImpl,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new AppError(
        'WhatsApp did not respond in time. Please try again.',
      );
    }
    throw new AppError(
      'Could not reach WhatsApp. Check your connection and try again.',
    );
  }
  return response;
}

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(
      parsed.error.issues[0]?.message ?? 'Invalid request.',
    );
  }
  return parsed.data;
}

async function sendPayload(
  input: { phoneNumberId: string; token: string },
  payload: TextPayload | TemplatePayload,
  fetchImpl: FetchImpl,
): Promise<{ messageId: string }> {
  const response = await postJson(
    messagesUrl(input.phoneNumberId),
    input.token,
    payload,
    fetchImpl,
  );
  if (!response.ok) {
    throw toAppError(response, await readErrorDetail(response));
  }
  const data: unknown = await response.json().catch(() => null);
  const messageId =
    typeof data === 'object' &&
    data !== null &&
    'messages' in data &&
    Array.isArray((data as { messages: unknown }).messages) &&
    typeof (data as { messages: Array<{ id?: unknown }> }).messages[0]?.id ===
      'string'
      ? ((data as { messages: Array<{ id: string }> }).messages[0] as { id: string }).id
      : null;
  if (!messageId) {
    throw new AppError(
      'WhatsApp accepted the message but returned no message ID.',
    );
  }
  return { messageId };
}

/** Sends a free-form text message via the WhatsApp Cloud API. */
export async function sendTextMessage(
  input: SendTextInput,
  fetchImpl: FetchImpl = fetch,
): Promise<{ messageId: string }> {
  const parsed = parseOrThrow(sendTextInputSchema, input);
  return sendPayload(parsed, buildTextPayload(parsed.to, parsed.body), fetchImpl);
}

/** Sends a template message via the WhatsApp Cloud API. */
export async function sendTemplateMessage(
  input: SendTemplateInput,
  fetchImpl: FetchImpl = fetch,
): Promise<{ messageId: string }> {
  const parsed = parseOrThrow(sendTemplateInputSchema, input);
  return sendPayload(
    parsed,
    buildTemplatePayload(
      parsed.to,
      parsed.templateName,
      parsed.language,
      parsed.templateParams,
    ),
    fetchImpl,
  );
}

/**
 * Fetches the business profile for a phone number ID.
 * Used by "Test connection" — a 200 with fields proves the token + ID pair works.
 */
export async function getBusinessProfile(
  input: BusinessProfileInput,
  fetchImpl: FetchImpl = fetch,
): Promise<BusinessProfile> {
  const parsed = parseOrThrow(businessProfileInputSchema, input);
  const url =
    `https://graph.facebook.com/${API_VERSION}/${parsed.phoneNumberId}` +
    `?fields=verified_name,display_phone_number`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${parsed.token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new AppError(
        'WhatsApp did not respond in time. Please try again.',
      );
    }
    throw new AppError(
      'Could not reach WhatsApp. Check your connection and try again.',
    );
  }
  if (!response.ok) {
    throw toAppError(response, await readErrorDetail(response));
  }
  const data: unknown = await response.json().catch(() => null);
  if (typeof data !== 'object' || data === null) {
    throw new AppError('WhatsApp returned an unexpected response.');
  }
  const record = data as Record<string, unknown>;
  return {
    verified_name:
      typeof record.verified_name === 'string' ? record.verified_name : null,
    display_phone_number:
      typeof record.display_phone_number === 'string'
        ? record.display_phone_number
        : null,
  };
}

/** Marks an inbound message as read (blue ticks / stops billing retries). */
export async function markRead(
  input: MarkReadInput,
  fetchImpl: FetchImpl = fetch,
): Promise<void> {
  const parsed = parseOrThrow(markReadInputSchema, input);
  const response = await postJson(
    messagesUrl(parsed.phoneNumberId),
    parsed.token,
    {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: parsed.messageId,
    },
    fetchImpl,
  );
  if (!response.ok) {
    throw toAppError(response, await readErrorDetail(response));
  }
}
