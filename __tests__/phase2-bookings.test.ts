import { describe, expect, it } from "vitest";

import {
  ALLOWED_TRANSITIONS,
  assertTransitionAllowed,
  BOOKING_STATUSES,
  buildBookingReference,
  canTransitionBooking,
  type BookingStatus,
} from "../src/services/bookings.service";

describe("booking reference generation (pure)", () => {
  it("builds PREFIX + (1000 + count)", () => {
    expect(buildBookingReference("BK-", 0)).toBe("BK-1000");
    expect(buildBookingReference("BK-", 42)).toBe("BK-1042");
  });

  it("respects custom prefixes from business_settings", () => {
    expect(buildBookingReference("CLN-", 7)).toBe("CLN-1007");
  });
});

describe("ALLOWED_TRANSITIONS", () => {
  it("covers all 16 statuses", () => {
    expect(BOOKING_STATUSES).toHaveLength(16);
    for (const status of BOOKING_STATUSES) {
      expect(ALLOWED_TRANSITIONS[status as BookingStatus]).toBeDefined();
    }
  });

  it("allows legal NEW -> PENDING_REVIEW", () => {
    expect(canTransitionBooking("NEW", "PENDING_REVIEW")).toBe(true);
    expect(() => assertTransitionAllowed("NEW", "PENDING_REVIEW")).not.toThrow();
  });

  it("rejects illegal NEW -> PAID with a human message", () => {
    expect(canTransitionBooking("NEW", "PAID")).toBe(false);
    expect(() => assertTransitionAllowed("NEW", "PAID")).toThrow("Cannot move booking from NEW to PAID.");
  });

  it("locks terminal PAID / CANCELLED / REJECTED", () => {
    for (const terminal of ["PAID", "CANCELLED", "REJECTED"] as const) {
      expect(ALLOWED_TRANSITIONS[terminal]).toEqual([]);
      expect(canTransitionBooking(terminal, "CONFIRMED")).toBe(false);
      expect(() => assertTransitionAllowed(terminal, "CONFIRMED")).toThrow(
        `Cannot move booking from ${terminal} to CONFIRMED.`,
      );
    }
  });

  it("walks the quote branch NEW -> ... -> AWAITING_CUSTOMER -> CONFIRMED", () => {
    const path: Array<[BookingStatus, BookingStatus]> = [
      ["NEW", "PENDING_REVIEW"],
      ["PENDING_REVIEW", "QUOTE_REQUIRED"],
      ["QUOTE_REQUIRED", "QUOTE_SENT"],
      ["QUOTE_SENT", "AWAITING_CUSTOMER"],
      ["AWAITING_CUSTOMER", "CONFIRMED"],
      ["CONFIRMED", "SCHEDULED"],
      ["SCHEDULED", "ASSIGNED"],
      ["ASSIGNED", "EN_ROUTE"],
      ["EN_ROUTE", "ARRIVED"],
      ["ARRIVED", "IN_PROGRESS"],
      ["IN_PROGRESS", "COMPLETED"],
      ["COMPLETED", "PAYMENT_PENDING"],
      ["PAYMENT_PENDING", "PAID"],
    ];
    for (const [from, to] of path) {
      expect(canTransitionBooking(from, to), `${from} -> ${to}`).toBe(true);
    }
  });

  it("rejects skipping steps (e.g. CONFIRMED -> COMPLETED)", () => {
    expect(canTransitionBooking("CONFIRMED", "COMPLETED")).toBe(false);
    expect(canTransitionBooking("SCHEDULED", "EN_ROUTE")).toBe(false);
  });
});
