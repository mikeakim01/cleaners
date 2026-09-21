import { describe, expect, it } from "vitest";

import { recalcInvoiceStatus } from "../src/services/invoices.service";
import {
  assertPaymentAllowedOnInvoice,
  assertPaymentWithinBalance,
  RecordPaymentInputSchema,
} from "../src/services/payments.service";
import { recordProviderPayment } from "../src/server/providers/payments";

const TOTAL = 11_800_000; // TZS 118,000 in minor units.

function confirmed(amount: number) {
  return { status: "CONFIRMED", amount_minor: amount };
}

describe("payment status progression (via recalcInvoiceStatus)", () => {
  it("a partial payment keeps the invoice PARTIAL with a remaining balance", () => {
    const next = recalcInvoiceStatus(
      { status: "SENT", total_minor: TOTAL, amount_paid_minor: 0 },
      [confirmed(5_000_000)],
    );
    expect(next).toBe("PARTIAL");
    expect(TOTAL - 5_000_000).toBe(6_800_000);
  });

  it("a full payment moves the invoice to PAID", () => {
    const next = recalcInvoiceStatus(
      { status: "PARTIAL", total_minor: TOTAL, amount_paid_minor: 5_000_000 },
      [confirmed(5_000_000), confirmed(6_800_000)],
    );
    expect(next).toBe("PAID");
  });

  it("PENDING payments do not move the status", () => {
    const next = recalcInvoiceStatus(
      { status: "SENT", total_minor: TOTAL, amount_paid_minor: 0 },
      [{ status: "PENDING", amount_minor: TOTAL }],
    );
    expect(next).toBe("SENT");
  });
});

describe("payment guards", () => {
  it("rejects payments that exceed the balance with formatted amounts", () => {
    expect(() => assertPaymentWithinBalance(7_000_000, TOTAL, 5_000_000, "TZS")).toThrow(
      "Payment of TZS 70,000 exceeds the TZS 68,000 balance.",
    );
  });

  it("accepts a payment exactly equal to the balance", () => {
    expect(assertPaymentWithinBalance(6_800_000, TOTAL, 5_000_000, "TZS")).toBe(6_800_000);
  });

  it("rejects payments on voided invoices", () => {
    expect(() => assertPaymentAllowedOnInvoice("VOID")).toThrow("Cannot take payment on a voided invoice.");
  });

  it("rejects payments on draft invoices", () => {
    expect(() => assertPaymentAllowedOnInvoice("DRAFT")).toThrow("Send this invoice before recording a payment.");
  });

  it("allows payments on SENT, PARTIAL and OVERDUE invoices", () => {
    for (const s of ["SENT", "PARTIAL", "OVERDUE"]) {
      expect(() => assertPaymentAllowedOnInvoice(s)).not.toThrow();
    }
  });
});

describe("RecordPaymentInputSchema", () => {
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const invoiceId = "22222222-2222-4222-8222-222222222222";

  it("rejects zero and negative amounts", () => {
    for (const amountMinor of [0, -100]) {
      const parsed = RecordPaymentInputSchema.safeParse({ invoiceId, amountMinor, provider: "cash" });
      expect(parsed.success).toBe(false);
    }
    expect(tenantId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects unknown providers", () => {
    const parsed = RecordPaymentInputSchema.safeParse({ invoiceId, amountMinor: 100, provider: "cheque" });
    expect(parsed.success).toBe(false);
  });
});

describe("recordProviderPayment (provider-level PENDING vs CONFIRMED)", () => {
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const invoiceId = "22222222-2222-4222-8222-222222222222";

  it("confirms cash immediately", async () => {
    const result = await recordProviderPayment(
      "cash",
      { tenantId, invoiceId, amountMinor: 1_000 },
      { userId: "33333333-3333-4333-8333-333333333333" },
    );
    expect(result.status).toBe("CONFIRMED");
  });

  it("holds mobile-money as PENDING without auto-confirm (default env)", async () => {
    const result = await recordProviderPayment(
      "mobile_money",
      { tenantId, invoiceId, amountMinor: 1_000, providerRef: "QA12B3C4D5" },
      { userId: "33333333-3333-4333-8333-333333333333" },
    );
    // PENDING payments are recorded but must not move amount_paid_minor —
    // recalcInvoiceStatus only counts CONFIRMED rows, so the invoice stays SENT.
    expect(result.status).toBe("PENDING");
    const next = recalcInvoiceStatus(
      { status: "SENT", total_minor: 1_000, amount_paid_minor: 0 },
      [{ status: result.status, amount_minor: 1_000 }],
    );
    expect(next).toBe("SENT");
  });

  it("rejects a malformed M-Pesa code", async () => {
    await expect(
      recordProviderPayment(
        "mobile_money",
        { tenantId, invoiceId, amountMinor: 1_000, providerRef: "abc" },
        { userId: "33333333-3333-4333-8333-333333333333" },
      ),
    ).rejects.toThrow("Enter the M-Pesa transaction code");
  });
});
