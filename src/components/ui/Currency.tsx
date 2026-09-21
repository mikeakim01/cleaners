import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";

export interface CurrencyProps {
  amountMinor: number;
  currency?: string;
  className?: string;
}

export function Currency({
  amountMinor,
  currency = "TZS",
  className,
}: CurrencyProps) {
  return (
    <span
      data-money
      className={cn("tabular-nums font-semibold text-ink", className)}
    >
      {formatMoney(amountMinor, currency)}
    </span>
  );
}
