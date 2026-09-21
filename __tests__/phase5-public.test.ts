import { describe, expect, it } from "vitest";

import {
  assertPublicScheduledDate,
  estimateBookingTotal,
  mapTimeSlotToHour,
  PublicBookingInputSchema,
} from "../src/services/public.service";

function eatDate(offsetDays: number): string {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offsetDays * 86400000);
  return day.toISOString().slice(0, 10);
}

describe("time slot mapping (pure)", () => {
  it("maps slots to EAT wall-clock hours", () => {
    expect(mapTimeSlotToHour("morning")).toBe(9);
    expect(mapTimeSlotToHour("midday")).toBe(12);
    expect(mapTimeSlotToHour("afternoon")).toBe(14);
    expect(mapTimeSlotToHour("evening")).toBe(16);
  });
});

describe("estimateBookingTotal (pure)", () => {
  it("sums service base + add-on bases", () => {
    expect(estimateBookingTotal(9500000, [])).toBe(9500000);
    expect(estimateBookingTotal(9500000, [100000, 250000])).toBe(9850000);
  });
});

describe("public booking phone validation", () => {
  const base = {
    serviceId: "11111111-1111-4111-8111-111111111111",
    propertyType: "house",
    scheduledDate: eatDate(3),
    timeSlot: "morning",
    fullName: "Amina Juma",
    phone: "+255712345678",
    address: "Mbezi Beach",
  };

  it("accepts a Tanzanian number", () => {
    expect(PublicBookingInputSchema.safeParse(base).success).toBe(true);
  });

  it("rejects non-Tanzanian numbers", () => {
    for (const phone of ["0712345678", "+254712345678", "+25571234", ""]) {
      const parsed = PublicBookingInputSchema.safeParse({ ...base, phone });
      expect(parsed.success).toBe(false);
    }
  });
});

describe("assertPublicScheduledDate (pure)", () => {
  it("rejects today and past dates", () => {
    expect(() => assertPublicScheduledDate(eatDate(0))).toThrow(
      "Please choose a future date for your cleaning.",
    );
    expect(() => assertPublicScheduledDate(eatDate(-5))).toThrow(
      "Please choose a future date for your cleaning.",
    );
  });

  it("rejects dates more than 60 days out", () => {
    expect(() => assertPublicScheduledDate(eatDate(61))).toThrow(
      "Bookings can only be made up to 60 days in advance.",
    );
  });

  it("accepts tomorrow through day 60", () => {
    expect(() => assertPublicScheduledDate(eatDate(1))).not.toThrow();
    expect(() => assertPublicScheduledDate(eatDate(60))).not.toThrow();
  });
});
