import { createHmac, timingSafeEqual } from "node:crypto";

export const PORTAL_COOKIE = "portal_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface PortalPayload {
  tid: string;
  cid: string;
  exp: number;
}

function resolveSecret(secret?: string): string {
  const raw = (secret ?? process.env.APP_ENCRYPTION_KEY ?? "").trim();
  if (!raw) {
    throw new Error("Portal sessions are not configured. Set APP_ENCRYPTION_KEY and try again.");
  }
  return raw;
}

function base64urlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function base64urlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

export function signPortalSession(
  ids: { tenantId: string; customerId: string },
  secret?: string,
): string {
  const key = resolveSecret(secret);
  if (!ids.tenantId || !ids.customerId) {
    throw new Error("A valid business and customer are required to start a portal session.");
  }
  const payload: PortalPayload = {
    tid: ids.tenantId,
    cid: ids.customerId,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  const sig = createHmac("sha256", key).update(payloadB64).digest("hex");
  return `${payloadB64}.${sig}`;
}

export function verifyPortalSession(
  cookieValue: string | null | undefined,
  secret?: string,
): { tenantId: string; customerId: string } | null {
  if (!cookieValue) return null;
  const key = resolveSecret(secret);
  const dot = cookieValue.lastIndexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = cookieValue.slice(0, dot);
  const sigHex = cookieValue.slice(dot + 1);
  const expected = createHmac("sha256", key).update(payloadB64).digest("hex");
  const a = Buffer.from(sigHex, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(base64urlDecode(payloadB64)) as Partial<PortalPayload>;
    if (
      typeof parsed.tid !== "string" ||
      typeof parsed.cid !== "string" ||
      typeof parsed.exp !== "number" ||
      !parsed.tid ||
      !parsed.cid
    ) {
      return null;
    }
    if (parsed.exp <= Date.now()) return null;
    return { tenantId: parsed.tid, customerId: parsed.cid };
  } catch {
    return null;
  }
}
