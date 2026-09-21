import { t } from "@/i18n";

function initials(name: string | null, phone: string): string {
  const base = (name ?? "").trim();
  if (base.length > 0) {
    const parts = base.split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || phone.slice(-2);
  }
  return phone.replace(/\D/g, "").slice(-2) || "??";
}

function timeOfDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export interface ConversationListProps {
  rows: Array<{
    id: string;
    phoneE164: string;
    customerName: string | null;
    status: "OPEN" | "RESOLVED";
    unreadCount: number;
    lastMessageAt: string | null;
    lastBody: string | null;
  }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Display-only conversation list: avatar initials, name/phone, snippet, unread pill, time. */
export function ConversationList({ rows, selectedId, onSelect }: ConversationListProps) {
  return (
    <ul className="flex flex-col" role="listbox" aria-label={t("whatsapp.inbox.conversations")}>
      {rows.map((c) => {
        const active = c.id === selectedId;
        const label = c.customerName?.trim() || c.phoneE164;
        const sub = c.customerName?.trim() ? c.phoneE164 : null;
        return (
          <li key={c.id}>
            <button
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => onSelect(c.id)}
              className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-canvas ${
                active ? "bg-tint" : ""
              }`}
            >
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-canvas text-sm font-bold text-primary"
              >
                {initials(c.customerName, c.phoneE164)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-ink">{label}</span>
                  {c.lastMessageAt ? (
                    <span className="shrink-0 text-[11px] tabular-nums text-faint">
                      {timeOfDay(c.lastMessageAt)}
                    </span>
                  ) : null}
                </span>
                {sub ? <span className="block truncate text-xs text-faint">{sub}</span> : null}
                <span className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] text-muted">{c.lastBody ?? "—"}</span>
                  {c.unreadCount > 0 ? (
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold tabular-nums text-white">
                      {c.unreadCount > 99 ? "99+" : c.unreadCount}
                    </span>
                  ) : null}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
