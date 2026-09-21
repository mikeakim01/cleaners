import * as React from "react";
import { cn } from "@/lib/cn";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  icon?: React.ReactNode;
}

export function Input({
  label,
  hint,
  error,
  icon,
  id,
  className,
  ...rest
}: InputProps) {
  const generatedId = React.useId();
  const inputId = id ?? rest.name ?? generatedId;
  const describedBy = error
    ? `${inputId}-error`
    : hint
      ? `${inputId}-hint`
      : undefined;
  return (
    <div className="flex w-full flex-col gap-1.5">
      {label ? (
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-ink"
        >
          {label}
        </label>
      ) : null}
      <div className="relative">
        {icon ? (
          <span
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
            aria-hidden="true"
          >
            {icon}
          </span>
        ) : null}
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "h-11 w-full rounded-input border bg-surface px-3.5 text-[15px] text-ink placeholder:text-faint",
            "focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary",
            icon && "pl-10",
            error
              ? "border-danger focus:ring-danger focus:border-danger"
              : "border-border",
            className,
          )}
          {...rest}
        />
      </div>
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
