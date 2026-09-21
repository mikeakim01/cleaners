import { describe, expect, it } from "vitest";

import { formatMoney } from "../src/lib/format";
import { calculatePrice } from "../src/lib/pricing";

describe("calculatePrice", () => {
  it("prices FIXED as base pass-through", () => {
    expect(
      calculatePrice({ model: "FIXED", baseMinor: 9500000, unitMinor: 0 }),
    ).toBe(9500000);
  });

  it("prices PER_HOUR as base + unit*hours", () => {
    expect(
      calculatePrice({
        model: "PER_HOUR",
        baseMinor: 100000,
        unitMinor: 250000,
        hours: 3,
      }),
    ).toBe(850000);
  });

  it("prices PER_ROOM as unit*rooms", () => {
    expect(
      calculatePrice({
        model: "PER_ROOM",
        baseMinor: 0,
        unitMinor: 1500000,
        rooms: 4,
      }),
    ).toBe(6000000);
  });

  it("prices PER_SQM as unit*sqm", () => {
    expect(
      calculatePrice({
        model: "PER_SQM",
        baseMinor: 0,
        unitMinor: 50000,
        sqm: 120,
      }),
    ).toBe(6000000);
  });

  it("prices PER_ITEM as unit*items", () => {
    expect(
      calculatePrice({
        model: "PER_ITEM",
        baseMinor: 0,
        unitMinor: 200000,
        items: 5,
      }),
    ).toBe(1000000);
  });

  it("prices PER_UNIT as unit*units", () => {
    expect(
      calculatePrice({
        model: "PER_UNIT",
        baseMinor: 0,
        unitMinor: 30000,
        units: 20,
      }),
    ).toBe(600000);
  });

  it("prices CUSTOM_QUOTE as base pass-through", () => {
    expect(
      calculatePrice({ model: "CUSTOM_QUOTE", baseMinor: 4500000, unitMinor: 0 }),
    ).toBe(4500000);
  });

  it("rejects negative inputs", () => {
    expect(() =>
      calculatePrice({ model: "FIXED", baseMinor: -1, unitMinor: 0 }),
    ).toThrow();
    expect(() =>
      calculatePrice({
        model: "PER_HOUR",
        baseMinor: 0,
        unitMinor: 100,
        hours: -2,
      }),
    ).toThrow();
    expect(() =>
      calculatePrice({ model: "CUSTOM_QUOTE", baseMinor: -5, unitMinor: 0 }),
    ).toThrow();
  });

  it("rejects unknown models", () => {
    expect(() =>
      calculatePrice({
        model: "WEEKLY" as never,
        baseMinor: 0,
        unitMinor: 0,
      }),
    ).toThrow();
  });
});

describe("cents semantics", () => {
  it("stores TZS 95,000 as 9500000 minor units", () => {
    expect(formatMoney(9500000, "TZS")).toBe("TZS 95,000");
  });

  it("formats USD cents with 2 decimals", () => {
    expect(formatMoney(150000, "USD")).toBe("USD 1,500.00");
  });
});
