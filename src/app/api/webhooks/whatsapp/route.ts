import { NextResponse } from "next/server";
import {
  ingestParsedPayload,
  type IngestResult,
} from "@/services/whatsapp-ingest.service";
import { parseWebhookPayload, verifyWebhookSignature } from "@/services/whatsapp.service";

// NOTE: No rate limiting is applied here yet. Meta retries deliveries, so if
// this endpoint ever needs throttling, prefer a queue (or 429 with
// Retry-After) over dropping — a 4xx/5xx makes Meta retry anyway.

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  const expected = process.env.WHATSAPP_VERIFY_TOKEN ?? "";
  if (mode === "subscribe" && expected && token === expected) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request): Promise<Response> {
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  const signature = req.headers.get("x-hub-signature-256") ?? req.headers.get("x-hub-signature");
  const appSecret = process.env.WHATSAPP_APP_SECRET ?? "";
  if (!verifyWebhookSignature(rawBody, signature, appSecret)) {
    return new Response("Invalid signature", { status: 401 });
  }

  // Zod-loose parse: never 500 to Meta on per-message errors — ingest wraps
  // every message in try/catch and always resolves.
  let payload: unknown = null;
  try {
    payload = rawBody ? (JSON.parse(rawBody) as unknown) : null;
  } catch {
    payload = null;
  }
  const parsed = parseWebhookPayload(payload);
  const result: IngestResult = await ingestParsedPayload(parsed);
  return NextResponse.json({ ok: true, routed: result.routed });
}
