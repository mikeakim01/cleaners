import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  normalizeWaPhone,
  parseWebhookPayload,
  verifyWebhookSignature,
} from "../src/services/whatsapp.service";

const SECRET = "test-app-secret";

function sign(body: string, secret: string = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

function textEntry(phoneNumberId: string, from: string, wabaId: string, body: string) {
  return {
    id: "WABA-1",
    changes: [
      {
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "255700000000", phone_number_id: phoneNumberId },
          messages: [
            { from, id: wabaId, timestamp: "1758355200", type: "text", text: { body } },
          ],
        },
        field: "messages",
      },
    ],
  };
}

describe("verifyWebhookSignature", () => {
  it("accepts a valid sha256= signature", () => {
    const body = '{"object":"whatsapp_business_account"}';
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("accepts a valid raw hex signature without the prefix", () => {
    const body = '{"hello":"world"}';
    expect(verifyWebhookSignature(body, sign(body).slice(7), SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = '{"hello":"world"}';
    const sig = sign(body);
    expect(verifyWebhookSignature('{"hello":"mars"}', sig, SECRET)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const body = '{"hello":"world"}';
    expect(verifyWebhookSignature(body, sign(body, "other-secret"), SECRET)).toBe(false);
  });

  it("rejects missing values", () => {
    const body = '{"hello":"world"}';
    expect(verifyWebhookSignature(body, null, SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, "", SECRET)).toBe(false);
    expect(verifyWebhookSignature("", sign("x"), SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body), "")).toBe(false);
  });

  it("rejects non-hex signatures", () => {
    expect(verifyWebhookSignature("body", "sha256=not-hex!!", SECRET)).toBe(false);
  });
});

describe("parseWebhookPayload", () => {
  it("parses a text message", () => {
    const parsed = parseWebhookPayload({
      object: "whatsapp_business_account",
      entry: [textEntry("PN-1", "255712345678", "wamid.1", "Hello")],
    });
    expect(parsed.phoneNumberId).toBe("PN-1");
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0]).toMatchObject({
      wabaId: "wamid.1",
      from: "255712345678",
      kind: "text",
      body: "Hello",
    });
    expect(parsed.statuses).toHaveLength(0);
  });

  it("parses an image with its caption", () => {
    const parsed = parseWebhookPayload({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA-1",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "PN-1" },
                messages: [
                  {
                    from: "255712345678",
                    id: "wamid.img",
                    timestamp: "1758355200",
                    type: "image",
                    image: { caption: "Before photo", mime_type: "image/jpeg", id: "media-1" },
                  },
                ],
              },
              field: "messages",
            },
          ],
        },
      ],
    });
    expect(parsed.messages[0]).toMatchObject({ kind: "image", body: "Before photo" });
  });

  it("parses delivered and read statuses", () => {
    const parsed = parseWebhookPayload({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA-1",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "PN-1" },
                statuses: [
                  { id: "wamid.1", status: "delivered", timestamp: "1758355201", recipient_id: "255712345678" },
                  { id: "wamid.1", status: "read", timestamp: "1758355300", recipient_id: "255712345678" },
                ],
              },
              field: "messages",
            },
          ],
        },
      ],
    });
    expect(parsed.statuses).toHaveLength(2);
    expect(parsed.statuses[0]).toMatchObject({ wabaId: "wamid.1", status: "delivered", recipient: "255712345678" });
    expect(parsed.statuses[1]).toMatchObject({ status: "read" });
  });

  it("maps unknown message kinds to 'unknown' with empty body and never throws", () => {
    const parsed = parseWebhookPayload({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA-1",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "PN-1" },
                messages: [
                  { from: "255712345678", id: "wamid.x", timestamp: "1", type: "sticker", sticker: { id: "s1" } },
                  { from: "255712345678", id: "wamid.y", timestamp: "1", type: "some_future_type" },
                ],
              },
              field: "messages",
            },
          ],
        },
      ],
    });
    expect(parsed.messages).toHaveLength(2);
    for (const m of parsed.messages) {
      expect(m.kind).toBe("unknown");
      expect(m.body).toBe("");
    }
  });

  it("ignores unknown shapes without throwing", () => {
    expect(parseWebhookPayload(null)).toEqual({ phoneNumberId: "", messages: [], statuses: [] });
    expect(parseWebhookPayload("garbage")).toEqual({ phoneNumberId: "", messages: [], statuses: [] });
    expect(parseWebhookPayload({})).toEqual({ phoneNumberId: "", messages: [], statuses: [] });
    expect(parseWebhookPayload({ entry: "nope" })).toEqual({ phoneNumberId: "", messages: [], statuses: [] });
    expect(
      parseWebhookPayload({ entry: [{ changes: [{ value: "nope", field: "messages" }] }, null, 42] }),
    ).toEqual({ phoneNumberId: "", messages: [], statuses: [] });
  });

  it("aggregates multi-entry payloads", () => {
    const parsed = parseWebhookPayload({
      object: "whatsapp_business_account",
      entry: [
        textEntry("PN-1", "255700000001", "wamid.a", "First"),
        {
          id: "WABA-1",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "PN-2" },
                messages: [{ from: "255700000002", id: "wamid.b", timestamp: "2", type: "text", text: { body: "Second" } }],
                statuses: [{ id: "wamid.a", status: "read", timestamp: "3", recipient_id: "255700000001" }],
              },
              field: "messages",
            },
          ],
        },
      ],
    });
    expect(parsed.phoneNumberId).toBe("PN-1");
    expect(parsed.messages.map((m) => m.wabaId)).toEqual(["wamid.a", "wamid.b"]);
    expect(parsed.statuses).toHaveLength(1);
  });
});

describe("normalizeWaPhone", () => {
  it("keeps digits and prepends +", () => {
    expect(normalizeWaPhone("255712345678")).toBe("+255712345678");
    expect(normalizeWaPhone("255 712-345-678")).toBe("+255712345678");
    expect(normalizeWaPhone("+255712345678")).toBe("+255712345678");
  });
});
