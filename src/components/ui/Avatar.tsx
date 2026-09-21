import { cn } from "@/lib/cn";

export interface AvatarProps {
  name: string;
  src?: string;
  size?: "sm" | "md" | "lg";
}

const sizes = {
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-12 text-base",
} as const;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function Avatar({ name, src, size = "md" }: AvatarProps) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      loading="lazy"
      className={cn(
        "rounded-full border border-border object-cover",
        sizes[size],
      )}
    />
  ) : (
    <span
      role="img"
      aria-label={name}
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-tint font-semibold text-primary",
        sizes[size],
      )}
    >
      {initials(name)}
    </span>
  );
}
