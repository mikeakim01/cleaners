export const DEFAULT_LOCALE = "en-GB" as const;
export const DEFAULT_TIMEZONE = "Africa/Dar_es_Salaam" as const;
export const DEFAULT_CURRENCY = "TZS" as const;

const GROUP_FMT = new Intl.NumberFormat("en-GB", {
  maximumFractionDigits: 0,
});

const GROUP_FMT_2DP = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Format a monetary value given in INTEGER minor units (cents) for ALL
 * currencies: value = major_units * 100. TZS has no fractional cents in
 * practice, so it displays with 0 decimals (Math.round(minor / 100)):
 * formatMoney(9500000) -> "TZS 95,000". Other currencies display 2 decimals:
 * formatMoney(150000, "USD") -> "USD 1,500.00".
 */
export function formatMoney(minor: number, currency: string = DEFAULT_CURRENCY): string {
  if (!Number.isFinite(minor)) return `${currency} 0`;
  if (currency === "TZS") {
    return `${currency} ${GROUP_FMT.format(Math.round(minor / 100))}`;
  }
  return `${currency} ${GROUP_FMT_2DP.format(minor / 100)}`;
}

type DateInput = Date | string | number;

function toDate(input: DateInput): Date | null {
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function partsInZone(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(date).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return { day: parts.day ?? "01", month: parts.month ?? "01", year: parts.year ?? "1970" };
}

/**
 * Format a date in Africa/Dar_es_Salaam by default.
 * Supports "DD/MM/YYYY" (default) and "DD MMM YYYY".
 */
export function formatDate(
  input: DateInput,
  format: "DD/MM/YYYY" | "DD MMM YYYY" = "DD/MM/YYYY",
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const d = toDate(input);
  if (!d) return "";
  if (format === "DD MMM YYYY") {
    const dtf = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    return dtf.format(d).replace(/,/g, "");
  }
  const { day, month, year } = partsInZone(d, timeZone);
  return `${day}/${month}/${year}`;
}

/**
 * Normalise a Tanzanian phone number to "+255 712 345 678".
 * Returns the trimmed input unchanged when it cannot be parsed.
 */
export function formatPhone255(input: string): string {
  const raw = input.trim();
  if (!raw) return raw;
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00255")) digits = digits.slice(2);
  if (digits.startsWith("255")) digits = digits.slice(3);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  if (!/^\d{9}$/.test(digits)) return raw;
  return `+255 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)}`;
}
