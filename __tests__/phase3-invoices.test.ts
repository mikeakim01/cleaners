import { describe, expect, it } from "vitest";

import {
  assertInvoiceCanSend,
  assertInvoiceCanVoid,
  buildInvoiceReference,
  computeInvoiceTotals,
  INVOICE_STATUSES,
  isOverdue,
  recalcInvoiceStatus,
} from "../src/services/invoices.service";

describe("computeInvoiceTotals (integer cents math)", () => {
  // 2 x TZS 450,000 + 1 x TZS 180,000 in minor units = 108,000,000 subtotal.
  const items = [
    { qty: 2, unitMinor: 45_000_000 },
    { qty: 1, unitMinor: 18_000_000 },
  ];

  it("computes subtotal as sum(qty * unit)", () => {
    const totals = computeInvoiceTotals(items, 0, 0, 18);
    expect(totals.subtotalMinor).toBe(108_000_000);
    expect(totals.totalMinor).toBe(108_000_000 + Math.round(108_000_000 * 0.18));
  });

  it("applies discount, then 18% VAT on the net, then adds the surcharge", () => {
    const discountMinor = 5_400_000; // 5%
    const surchargeMinor = 200_000;
    const totals = computeInvoiceTotals(items, discountMinor, surchargeMinor, 18);
    expect(totals.discountMinor).toBe(5_400_000);
    // VAT = round((108,000,000 - 5,400,000) * 18 / 100) = 18,468,000
    expect(totals.vatMinor).toBe(18_468_000);
    expect(totals.surchargeMinor).toBe(200_000);
    expect(totals.totalMinor).toBe(102_600_000 + 18_468_000 + 200_000);
  });

  it("keeps every figure an integer", () => {
    const totals = computeInvoiceTotals(
      [
        { qty: 1.5, unitMinor: 999 },
        { qty: 3, unitMinor: 333 },
      ],
      100,
      7,
      18,
    );
    for (const value of [totals.subtotalMinor, totals.discountMinor, totals.vatMinor, totals.surchargeMinor, totals.totalMinor]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("clamps an over-discount to the subtotal (never negative totals)", () => {
    const totals = computeInvoiceTotals(items, 999_999_999, 0, 18);
    expect(totals.discountMinor).toBe(108_000_000);
    expect(totals.vatMinor).toBe(0);
    expect(totals.totalMinor).toBe(0);
  });

  it("builds references as PREFIX + (1000 + count)", () => {
    expect(buildInvoiceReference("INV-", 0)).toBe("INV-1000");
    expect(buildInvoiceReference("INV-", 41)).toBe("INV-1041");
  });
});

describe("invoice status guards", () => {
  it("allows DRAFT -> SENT", () => {
    expect(() => assertInvoiceCanSend("DRAFT")).not.toThrow();
  });

  it("rejects sending a non-draft invoice", () => {
    expect(() => assertInvoiceCanSend("SENT")).toThrow("Only draft invoices can be sent.");
    expect(() => assertInvoiceCanSend("PAID")).toThrow("Only draft invoices can be sent.");
  });

  it("allows voiding DRAFT, SENT and OVERDUE", () => {
    for (const s of ["DRAFT", "SENT", "OVERDUE"] as const) {
      expect(() => assertInvoiceCanVoid(s)).not.toThrow();
    }
  });

  it("rejects voiding PAID and PARTIAL invoices", () => {
    expect(() => assertInvoiceCanVoid("PAID")).toThrow("Only unpaid invoices can be voided.");
    expect(() => assertInvoiceCanVoid("PARTIAL")).toThrow("Only unpaid invoices can be voided.");
  });

  it("covers all 6 invoice statuses", () => {
    expect(INVOICE_STATUSES).toEqual(["DRAFT", "SENT", "PARTIAL", "PAID", "OVERDUE", "VOID"]);
  });
});

describe("recalcInvoiceStatus", () => {
  const base = { status: "SENT" as const, total_minor: 10_000 };

  it("stays SENT with no confirmed payments", () => {
    expect(recalcInvoiceStatus({ ...base, amount_paid_minor: 0 }, [])).toBe("SENT");
  });

  it("moves to PARTIAL on a partial confirmed payment", () => {
    expect(
      recalcInvoiceStatus({ ...base, amount_paid_minor: 0 }, [{ status: "CONFIRMED", amount_minor: 4_000 }]),
    ).toBe("PARTIAL");
  });

  it("moves to PAID when confirmed payments cover the total", () => {
    expect(
      recalcInvoiceStatus(
        { ...base, amount_paid_minor: 0 },
        [
          { status: "CONFIRMED", amount_minor: 4_000 },
          { status: "CONFIRMED", amount_minor: 6_000 },
        ],
      ),
    ).toBe("PAID");
  });

  it("ignores PENDING payments", () => {
    expect(
      recalcInvoiceStatus({ ...base, amount_paid_minor: 0 }, [{ status: "PENDING", amount_minor: 10_000 }]),
    ).toBe("SENT");
  });

  it("leaves DRAFT and VOID untouched", () => {
    expect(
      recalcInvoiceStatus({ ...base, status: "DRAFT", amount_paid_minor: 0 }, [{ status: "CONFIRMED", amount_minor: 10_000 }]),
    ).toBe("DRAFT");
    expect(
      recalcInvoiceStatus({ ...base, status: "VOID", amount_paid_minor: 0 }, [{ status: "CONFIRMED", amount_minor: 10_000 }]),
    ).toBe("VOID");
  });
});

describe("isOverdue", () => {
  const now = new Date("2026-09-20T12:00:00.000Z");

  it("flags a SENT invoice past its due date", () => {
    expect(isOverdue("SENT", "2026-09-19", now)).toBe(true);
  });

  it("does not flag future due dates, missing dates, or non-SENT statuses", () => {
    expect(isOverdue("SENT", "2026-09-20", now)).toBe(false);
    expect(isOverdue("SENT", "2026-09-21", now)).toBe(false);
    expect(isOverdue("SENT", null, now)).toBe(false);
    expect(isOverdue("PARTIAL", "2026-09-01", now)).toBe(false);
    expect(isOverdue("DRAFT", "2026-09-01", now)).toBe(false);
  });
});
