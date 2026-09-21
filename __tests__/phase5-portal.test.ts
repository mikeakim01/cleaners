import { describe, expect, it } from "vitest";

import {
  codesMatch,
  generateAccessCode,
  hashAccessCode,
} from "../src/services/portal.service";
import { signPortalSession, verifyPortalSession } from "../src/lib/portal-session";

const SECRET = "test-portal-secret-key";
const OTHER_SECRET = "different-portal-secret";
const TID = "11111111-1111-4111-8111-111111111111";
const CID = "22222222-2222-4222-8222-222222222222";

describe("portal session sign/verify roundtrip", () => {
  it("round-trips tenant + customer ids", () => {
    const token = signPortalSession({ tenantId: TID, customerId: CID }, SECRET);
    expect(verifyPortalSession(token, SECRET)).toEqual({ tenantId: TID, customerId: CID });
  });

  it("rejects tampered payloads", () => {
    const token = signPortalSession({ tenantId: TID, customerId: CID }, SECRET);
    const [payload, sig] = token.split(".");
    const tampered = `${payload}x.${sig}`;
    expect(verifyPortalSession(tampered, SECRET)).toBeNull();
    expect(verifyPortalSession(`${payload}.deadbeef`, SECRET)).toBeNull();
  });

  it("rejects expired sessions", () => {
    const token = signPortalSession({ tenantId: TID, customerId: CID }, SECRET);
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 31 * 24 * 60 * 60 * 1000;
      expect(verifyPortalSession(token, SECRET)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it("rejects the wrong secret", () => {
    const token = signPortalSession({ tenantId: TID, customerId: CID }, SECRET);
    expect(verifyPortalSession(token, OTHER_SECRET)).toBeNull();
  });

  it("rejects empty / malformed cookies", () => {
    expect(verifyPortalSession(null, SECRET)).toBeNull();
    expect(verifyPortalSession("", SECRET)).toBeNull();
    expect(verifyPortalSession("no-dot-here", SECRET)).toBeNull();
  });

  it("fails closed when the secret is missing", () => {
    const saved = process.env.APP_ENCRYPTION_KEY;
    delete process.env.APP_ENCRYPTION_KEY;
    try {
      expect(() => signPortalSession({ tenantId: TID, customerId: CID })).toThrow();
    } finally {
      if (saved !== undefined) process.env.APP_ENCRYPTION_KEY = saved;
    }
  });
});

describe("access code hash compare (pure)", () => {
  it("matches the correct code and rejects others", () => {
    const stored = hashAccessCode("482910");
    expect(codesMatch(stored, "482910")).toBe(true);
    expect(codesMatch(stored, "482911")).toBe(false);
    expect(codesMatch(stored, "")).toBe(false);
  });

  it("generates zero-padded 6-digit codes", () => {
    for (let i = 0; i < 25; i++) {
      expect(generateAccessCode()).toMatch(/^\d{6}$/);
    }
  });
});
