import { describe, expect, it } from "vitest";

import {
  buildPlanChangedEvent,
  isTrialExpired,
  pickExpiredTrials,
  planPriceLabel,
  summarizeUsage,
  trialDaysLeft,
} from "../src/services/billing.service";

describe("trialDaysLeft", () => {
  const now = new Date("2026-09-20T12:00:00.000Z");

  it("returns 14 for a trial ending exactly 14 days out", () => {
    expect(trialDaysLeft("2026-10-04T12:00:00.000Z", now)).toBe(14);
  });

  it("rounds a partial day up", () => {
    expect(trialDaysLeft("2026-09-21T00:00:00.000Z", now)).toBe(1);
  });

  it("returns 0 for an expired trial", () => {
    expect(trialDaysLeft("2026-09-19T12:00:00.000Z", now)).toBe(0);
  });

  it("returns 0 for missing or invalid trial ends", () => {
    expect(trialDaysLeft(null, now)).toBe(0);
    expect(trialDaysLeft(undefined, now)).toBe(0);
    expect(trialDaysLeft("not-a-date", now)).toBe(0);
  });
});

describe("isTrialExpired", () => {
  const now = new Date("2026-09-20T12:00:00.000Z");

  it("is false while trial time remains", () => {
    expect(isTrialExpired("2026-09-25T00:00:00.000Z", now)).toBe(false);
  });

  it("is true when expired or absent", () => {
    expect(isTrialExpired("2026-09-19T00:00:00.000Z", now)).toBe(true);
    expect(isTrialExpired(null, now)).toBe(true);
  });
});

describe("pickExpiredTrials", () => {
  const now = new Date("2026-09-20T12:00:00.000Z");
  const rows = [
    { id: "past", trial_ends_at: "2026-09-19T12:00:00.000Z" },
    { id: "boundary", trial_ends_at: "2026-09-20T12:00:00.000Z" },
    { id: "future", trial_ends_at: "2026-09-21T12:00:00.000Z" },
    { id: "missing", trial_ends_at: null },
  ];

  it("picks strictly-expired trials only (boundary stays trialing)", () => {
    expect(pickExpiredTrials(rows, now).map((r) => r.id)).toEqual(["past"]);
  });

  it("returns an empty list when nothing expired", () => {
    expect(pickExpiredTrials(rows.slice(1), now)).toEqual([]);
  });
});

describe("summarizeUsage", () => {
  const counts = { branches: 2, staff: 9, bookings_per_month: 190, whatsapp_messages: 40 };

  it("maps the four meters with used/limit flags", () => {
    const meters = summarizeUsage(counts, { branches: 3, staff: 10, bookings_per_month: 200, whatsapp_messages: 500 });
    expect(meters).toEqual([
      { key: "branches", used: 2, limit: 3, unlimited: false },
      { key: "staff", used: 9, limit: 10, unlimited: false },
      { key: "bookings_per_month", used: 190, limit: 200, unlimited: false },
      { key: "whatsapp_messages", used: 40, limit: 500, unlimited: false },
    ]);
  });

  it("marks -1 limits as unlimited (Enterprise convention)", () => {
    const meters = summarizeUsage(counts, { branches: -1, staff: -1, bookings_per_month: -1, whatsapp_messages: -1 });
    expect(meters.every((m) => m.unlimited)).toBe(true);
  });
});

describe("planPriceLabel", () => {
  it("formats TZS minor units with no decimals", () => {
    expect(planPriceLabel(9_500_000, "TZS")).toBe("TZS 95,000");
  });
});

describe("buildPlanChangedEvent", () => {
  it("builds the subscription_events row for a plan change", () => {
    const row = buildPlanChangedEvent({
      subscriptionId: "sub-1",
      tenantId: "tenant-1",
      userId: "user-1",
      fromPlanId: "plan-a",
      fromPlanName: "Starter",
      toPlanId: "plan-b",
      toPlanName: "Growth",
    });
    expect(row).toMatchObject({
      tenant_id: "tenant-1",
      subscription_id: "sub-1",
      type: "plan_changed",
      amount_minor: 0,
      user_id: "user-1",
    });
    expect(row.metadata).toMatchObject({ fromPlanName: "Starter", toPlanName: "Growth" });
  });
});
