import { describe, expect, it } from "vitest";

import {
  assertQuoteTransitionAllowed,
  canTransitionQuote,
  computeQuoteTotals,
  QUOTE_TRANSITIONS,
  QUOTE_STATUSES,
} from "../src/services/quotes.service";

describe("quote totals (integer cents math)", () => {
  // 2 x 45,000,000 + 1 x 18,000,000 = 108,000,000 subtotal.
  const items = [
    { qty: 2, unitMinor: 45_000_000 },
    { qty: 1, unitMinor: 18_000_000 },
  ];

  it("computes subtotal as sum(qty * unit)", () => {
    const totals = computeQuoteTotals(items, 0, 18);
    expect(totals.subtotalMinor).toBe(108_000_000);
  });

  it("applies a 5% discount then 18% VAT on the net amount", () => {
    const discountMinor = Math.round(108_000_000 * 0.05); // 5,400,000
    const totals = computeQuoteTotals(items, discountMinor, 18);
    expect(totals.discountMinor).toBe(5_400_000);
    // VAT = round((108,000,000 - 5,400,000) * 18 / 100) = 18,468,000
    expect(totals.vatMinor).toBe(18_468_000);
    expect(totals.totalMinor).toBe(102_600_000 + 18_468_000);
  });

  it("keeps every figure an integer", () => {
    const totals = computeQuoteTotals([{ qty: 1.5, unitMinor: 999 }, { qty: 3, unitMinor: 333 }], 100, 18);
    for (const value of [totals.subtotalMinor, totals.discountMinor, totals.vatMinor, totals.totalMinor]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("clamps discounts to the subtotal (never negative totals)", () => {
    const totals = computeQuoteTotals(items, 999_999_999, 18);
    expect(totals.discountMinor).toBe(108_000_000);
    expect(totals.totalMinor).toBe(0);
  });
});

describe("QUOTE_TRANSITIONS", () => {
  it("covers all 5 quote statuses", () => {
    expect(QUOTE_STATUSES).toHaveLength(5);
    for (const status of QUOTE_STATUSES) {
      expect(QUOTE_TRANSITIONS[status]).toBeDefined();
    }
  });

  it("allows DRAFT -> SENT", () => {
    expect(canTransitionQuote("DRAFT", "SENT")).toBe(true);
    expect(() => assertQuoteTransitionAllowed("DRAFT", "SENT")).not.toThrow();
  });

  it("rejects DRAFT -> APPROVED (must be sent first)", () => {
    expect(canTransitionQuote("DRAFT", "APPROVED")).toBe(false);
    expect(() => assertQuoteTransitionAllowed("DRAFT", "APPROVED")).toThrow(
      "Cannot move quote from DRAFT to APPROVED.",
    );
  });

  it("walks SENT -> APPROVED and SENT -> REJECTED", () => {
    expect(canTransitionQuote("SENT", "APPROVED")).toBe(true);
    expect(canTransitionQuote("SENT", "REJECTED")).toBe(true);
  });

  it("locks terminal APPROVED / REJECTED / EXPIRED", () => {
    for (const terminal of ["APPROVED", "REJECTED", "EXPIRED"] as const) {
      expect(QUOTE_TRANSITIONS[terminal]).toEqual([]);
    }
  });
});
