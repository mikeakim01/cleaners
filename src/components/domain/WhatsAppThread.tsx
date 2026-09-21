import { Check, CheckCheck, CircleAlert } from "lucide-react";
import { formatDate } from "@/lib/format";
import { t } from "@/i18n";
import type { WaMessage } from "@/lib/wa-types";

function timeOfDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function Ticks({ status }: { status: WaMessage["status"] }) {
  if (status === "read") return <CheckCheck size={18} aria-label="Read" className="text-sky-500" />;
  if (status === "delivered" || status === "sent")
    return <CheckCheck size={18} aria-label={status} className="text-zinc-400" />;
  if (status === "failed") return <CircleAlert size={18} aria-label="Failed" className="text-red-500" />;
  return <Check size={18} aria-label="Sending" className="text-zinc-300" />;
}

export interface WhatsAppThreadProps {
  messages: WaMessage[];
}

/** Display-only message thread: inbound/outbound bubbles, ticks, template chip, DD/MM/YYYY dividers. */
export function WhatsAppThread({ messages }: WhatsAppThreadProps) {
  const withDividers = messages.map((m, i) => {
    const day = formatDate(m.createdAt);
    const prevDay = i > 0 ? formatDate(messages[i - 1]?.createdAt ?? "") : "";
    return { message: m, day, showDivider: day !== prevDay };
  });
  return (
    <div className="flex flex-col gap-1.5" aria-live="polite">
      {withDividers.map(({ message: m, day, showDivider }) => {
        const outbound = m.direction === "outbound";
        return (
          <div key={m.id}>
            {showDivider ? (
              <div className="my-2 flex justify-center">
                <span className="rounded-full bg-canvas px-3 py-1 text-[11px] font-medium tabular-nums text-muted">
                  {day || t("whatsapp.inbox.unknownDate")}
                </span>
              </div>
            ) : null}
            <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 ${
                  outbound
                    ? "rounded-br-md bg-tint text-ink"
                    : "rounded-bl-md border border-border bg-surface text-ink"
                }`}
              >
                {m.kind === "template" && m.templateName ? (
                  <span className="mb-1 inline-block rounded-full bg-canvas px-2 py-0.5 text-[11px] font-semibold text-muted">
                    {m.templateName}
                  </span>
                ) : null}
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>
                <span className="mt-1 flex items-center justify-end gap-1 text-[11px] tabular-nums text-faint">
                  {timeOfDay(m.createdAt)}
                  {outbound ? <Ticks status={m.status} /> : null}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
