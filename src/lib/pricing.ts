import { z } from "zod";

/**
 * Supported service pricing models.
 * All money values are INTEGER minor units (cents):
 * TZS 95,000 is stored as 9500000. All math stays in integers.
 */
export const PRICING_MODELS = [
  "FIXED",
  "PER_HOUR",
  "PER_ROOM",
  "PER_SQM",
  "PER_ITEM",
  "PER_UNIT",
  "CUSTOM_QUOTE",
] as const;

export type PricingModel = (typeof PRICING_MODELS)[number];

export const PricingInput = z.object({
  model: z.enum(PRICING_MODELS),
  baseMinor: z.number().int(),
  unitMinor: z.number().int(),
  hours: z.number().optional(),
  rooms: z.number().optional(),
  sqm: z.number().optional(),
  items: z.number().optional(),
  units: z.number().optional(),
});

export type PricingInput = z.infer<typeof PricingInput>;

function requireNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
}

/**
 * Calculate a price in INTEGER minor units (cents).
 * FIXED = base; PER_HOUR = base + unit*hours; PER_ROOM = unit*rooms;
 * PER_SQM = unit*sqm; PER_ITEM = unit*items; PER_UNIT = unit*units;
 * CUSTOM_QUOTE = base pass-through.
 */
export function calculatePrice(input: PricingInput): number {
  const parsed = PricingInput.parse(input);
  requireNonNegative(parsed.baseMinor, "baseMinor");
  requireNonNegative(parsed.unitMinor, "unitMinor");

  switch (parsed.model) {
    case "FIXED":
      return Math.round(parsed.baseMinor);
    case "PER_HOUR": {
      const hours = parsed.hours ?? 0;
      requireNonNegative(hours, "hours");
      return Math.round(parsed.baseMinor + parsed.unitMinor * hours);
    }
    case "PER_ROOM": {
      const rooms = parsed.rooms ?? 0;
      requireNonNegative(rooms, "rooms");
      return Math.round(parsed.unitMinor * rooms);
    }
    case "PER_SQM": {
      const sqm = parsed.sqm ?? 0;
      requireNonNegative(sqm, "sqm");
      return Math.round(parsed.unitMinor * sqm);
    }
    case "PER_ITEM": {
      const items = parsed.items ?? 0;
      requireNonNegative(items, "items");
      return Math.round(parsed.unitMinor * items);
    }
    case "PER_UNIT": {
      const units = parsed.units ?? 0;
      requireNonNegative(units, "units");
      return Math.round(parsed.unitMinor * units);
    }
    case "CUSTOM_QUOTE":
      return Math.round(parsed.baseMinor);
    default:
      throw new Error(`Unknown pricing model: ${String(parsed.model)}`);
  }
}
