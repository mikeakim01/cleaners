import * as React from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/cn";

export interface DatePickerProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  error?: string;
}

export function DatePicker({ label, error, id, className, ...rest }: DatePickerProps) {
  const generatedId = React.useId();
  const inputId = id ?? rest.name ?? generatedId;
  return (
    <div className="flex w-full flex-col gap-1.5">
      {label ? (
        <label htmlFor={inputId} className="text-sm font-medium text-ink">
          {label}
        </label>
      ) : null}
      <div className="relative">
        <input
          id={inputId}
          type="date"
          aria-invalid={error ? true : undefined}
          className={cn(
            "h-11 w-full rounded-input border bg-surface px-3.5 pr-10 text-[15px] text-ink",
            "focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary",
            error ? "border-danger" : "border-border",
            className,
          )}
          {...rest}
        />
        <CalendarDays
          size={18}
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-faint"
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
