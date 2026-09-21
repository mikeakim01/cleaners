import { describe, expect, it } from "vitest";

import {
  buildImpersonationAudit,
  CreatePlanInputSchema,
  NotSuperAdminError,
  suspendedMessage,
} from "../src/services/admin.service";

describe("suspendedMessage", () => {
  it("maps suspended=true to the suspension message", () => {
    expect(suspendedMessage(true)).toBe("Tenant suspended.");
  });

  it("maps suspended=false to the reactivation message", () => {
    expect(suspendedMessage(false)).toBe("Tenant reactivated.");
  });
});

describe("buildImpersonationAudit", () => {
  it("builds the dual platform + tenant audit payloads", () => {
    const payload = buildImpersonationAudit({ adminId: "admin-1", tenantId: "tenant-1" });
    expect(payload.platform).toMatchObject({
      actorUserId: "admin-1",
      action: "admin.tenant_viewed",
      tenantId: "tenant-1",
    });
    expect(payload.platform.metadata).toMatchObject({ adminId: "admin-1" });
    expect(payload.tenant).toMatchObject({ action: "admin.impersonated" });
    expect(payload.tenant.metadata).toMatchObject({ adminId: "admin-1" });
  });
});

describe("CreatePlanInputSchema", () => {
  it("accepts a valid plan", () => {
    const parsed = CreatePlanInputSchema.safeParse({
      name: "Growth",
      priceMinor: 4_900_000,
      currency: "TZS",
      trialDays: 14,
      limits: { branches: 5 },
      features: ["Priority support"],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects negative prices and trial days", () => {
    expect(CreatePlanInputSchema.safeParse({ name: "Bad", priceMinor: -1 }).success).toBe(false);
    expect(CreatePlanInputSchema.safeParse({ name: "Bad", priceMinor: 100, trialDays: -1 }).success).toBe(false);
  });
});

describe("NotSuperAdminError", () => {
  it("carries the platform-admin message", () => {
    expect(new NotSuperAdminError().message).toBe("Platform admin access required.");
  });
});
