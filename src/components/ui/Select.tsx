import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
}

export function Select({
  label,
  error,
  options,
  placeholder,
  id,
  className,
  children,
  ...rest
}: SelectProps) {
  const generatedId = React.useId();
  const selectId = id ?? rest.name ?? generatedId;
  return (
    <div className="flex w-full flex-col gap-1.5">
      {label ? (
        <label htmlFor={selectId} className="text-sm font-medium text-ink">
          {label}
        </label>
      ) : null}
      <div className="relative">
        <select
          id={selectId}
          aria-invalid={error ? true : undefined}
          className={cn(
            "h-11 w-full appearance-none rounded-input border bg-surface pl-3.5 pr-10 text-[15px] text-ink",
            "focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary",
            error ? "border-danger" : "border-border",
            className,
          )}
          {...rest}
        >
          {placeholder ? <option value="">{placeholder}</option> : null}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {children}
        </select>
        <ChevronDown
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
