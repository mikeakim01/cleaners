"use client";

import { useState } from "react";
import {
  Avatar,
  Button,
  Currency,
  Drawer,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  StatusBadge,
} from "@/components/ui";
import type { StatusKind } from "@/components/ui/StatusBadge";
import { AssignmentPicker } from "@/components/domain/AssignmentPicker";
import { BookingTimeline } from "@/components/domain/BookingTimeline";
import { useBookingDetail } from "@/hooks/useBookingDetail";
import { useEmployees } from "@/hooks/useEmployees";
import { useJobs } from "@/hooks/useJobs";
import { useQuotes } from "@/hooks/useQuotes";
import { useTeams } from "@/hooks/useTeams";
import { formatDate, formatPhone255 } from "@/lib/format";
import { t } from "@/i18n";
import type { BookingDetail } from "@/lib/trackf-types";

const KIND_BY_STATUS: Record<string, StatusKind> = {
  pending: "pending",
  quote_sent: "warning",
  quote_approved: "info",
  confirmed: "confirmed",
  scheduled: "info",
  assigned: "confirmed",
  en_route: "in_progress",
  arrived: "in_progress",
  in_progress: "in_progress",
  on_hold: "warning",
  quality_check: "info",
  completed: "completed",
  invoiced: "info",
  paid: "success",
  cancelled: "cancelled",
  rejected: "danger",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-zinc-500">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function BookingDetailClient({
  tenantId,
  reference,
  initial,
}: {
  tenantId: string;
  reference: string;
  initial: BookingDetail | null;
}) {
  const detail = useBookingDetail(tenantId, reference);
  const booking = detail.data ?? initial;
  const quotes = useQuotes(tenantId);
  const jobs = useJobs(tenantId);
  const employees = useEmployees(tenantId);
  const { teams } = useTeams(tenantId);

  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quoteTotal, setQuoteTotal] = useState("");
  const [assignOpen, setAssignOpen] = useState(false);
  const [teamId, setTeamId] = useState("");
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [notes, setNotes] = useState<{ text: string; at: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  if (detail.isPending && !booking) return <LoadingState label={t("common.loading")} />;
  if (detail.isError && !booking) {
    return (
      <ErrorState
        message={(detail.error as Error).message}
        onRetry={() => detail.refetch()}
        retryLabel={t("common.retry")}
      />
    );
  }
  if (!booking) return <ErrorState message={t("common.errorNoData")} />;

  const mapsUrl =
    booking.siteLocationUrl ??
    `https://maps.google.com/?q=${encodeURIComponent(
      [booking.address, booking.ward].filter(Boolean).join(", "),
    )}`;

  const createQuote = async () => {
    setFeedback(null);
    try {
      await quotes.create.mutateAsync({
        bookingReference: booking.reference,
        totalMinor: Number(quoteTotal) || booking.totalMinor,
      });
      setFeedback(t("bookingDetail.quoteCreated"));
      setQuoteOpen(false);
    } catch (e) {
      setFeedback((e as Error).message);
    }
  };

  const confirmAssign = async () => {
    setFeedback(null);
    try {
      if (!booking.jobId) return;
      if (teamId) {
        await jobs.assignTeamToJob.mutateAsync({ jobId: booking.jobId, teamId });
      }
      if (employeeIds.length > 0) {
        await jobs.assignEmployeesToJob.mutateAsync({
          jobId: booking.jobId,
          employeeIds,
        });
      }
      setFeedback(t("jobs.assignSuccess"));
      setAssignOpen(false);
    } catch (e) {
      setFeedback((e as Error).message);
    }
  };

  const postNote = () => {
    if (!draft.trim()) return;
    setNotes((n) => [...n, { text: draft.trim(), at: new Date().toISOString() }]);
    setDraft("");
  };

  const history = booking.history ?? [];
  const activity = booking.activity ?? history;
  const allNotes = [...(booking.opsNotes ?? []), ...notes.map((n) => ({ text: n.text, at: n.at }))];
  const paid = booking.paidMinor ?? 0;
  const total = booking.lineItems?.reduce((s, l) => s + l.amountMinor, 0) ?? booking.totalMinor;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold tracking-tight tabular-nums">{booking.reference}</h1>
        <StatusBadge status={KIND_BY_STATUS[booking.status] ?? "pending"} label={booking.status} />
        <span className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setQuoteOpen(true)}>
            {t("bookingDetail.createQuote")}
          </Button>
          <span title={t("bookingDetail.rescheduleSoon")}>
            <Button size="sm" variant="secondary" disabled>
              {t("bookingDetail.reschedule")}
            </Button>
          </span>
          <span title={booking.jobId ? undefined : t("bookingDetail.assignNeedsJob")}>
            <Button
              size="sm"
              variant="secondary"
              disabled={!booking.jobId}
              onClick={() => setAssignOpen(true)}
            >
              {t("bookingDetail.assignCleaner")}
            </Button>
          </span>
          <span title={t("ops.whatsappPhase4")}>
            <Button size="sm" variant="secondary" disabled>
              {t("bookingDetail.whatsappClient")} · Phase 4
            </Button>
          </span>
        </span>
      </div>

      {feedback ? (
        <p role="status" className="rounded-card bg-tint px-4 py-2 text-sm text-primary">
          {feedback}
        </p>
      ) : null}

      <Section title={booking.reference}>
        <BookingTimeline status={booking.status} history={history} />
      </Section>

      <Section title={t("bookingDetail.servicePricing")}>
        <ul className="flex flex-col gap-1 text-sm">
          {(booking.lineItems ?? [{ label: booking.serviceName, amountMinor: booking.totalMinor }]).map(
            (l, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="text-muted">{l.label}</span>
                <Currency amountMinor={l.amountMinor} currency={booking.currency ?? "TZS"} />
              </li>
            ),
          )}
          <li className="mt-1 flex items-center justify-between gap-2 border-t border-border pt-2 font-semibold">
            <span>{t("bookingDetail.total")}</span>
            <Currency amountMinor={total} currency={booking.currency ?? "TZS"} />
          </li>
        </ul>
      </Section>

      <Section title={t("bookingDetail.propertyProfile")}>
        {(booking.propertyProfile ?? []).length === 0 ? (
          <p className="text-sm text-muted">
            {booking.customerName}
            {booking.customerPhone ? ` · ${formatPhone255(booking.customerPhone)}` : ""}
          </p>
        ) : (
          <dl className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
            {(booking.propertyProfile ?? []).map((p, i) => (
              <div key={i} className="flex justify-between gap-2">
                <dt className="text-muted">{p.label}</dt>
                <dd className="font-medium">{p.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Section>

      <Section title={t("bookingDetail.siteLocation")}>
        <p className="text-sm">
          {[booking.address, booking.ward].filter(Boolean).join(", ") || "–"}
        </p>
        <p className="mt-1 text-xs text-muted">{t("bookingDetail.siteLocationHint")}</p>
        <a
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-sm font-semibold text-primary underline-offset-2 hover:underline"
        >
          {t("bookingDetail.openInMaps")}
        </a>
      </Section>

      <Section title={t("bookingDetail.fieldDeployment")}>
        {(booking.crew ?? []).length === 0 ? (
          <p className="text-sm text-muted">{t("bookingDetail.unassignedCrew")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(booking.crew ?? []).map((c) => (
              <li key={c.name} className="flex items-center gap-2 text-sm">
                <Avatar name={c.name} src={c.avatarUrl} size="sm" />
                <span className="font-medium">{c.name}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("bookingDetail.accountOverview")}>
        <ul className="flex flex-col gap-1 text-sm">
          <li className="flex justify-between">
            <span className="text-muted">{t("bookingDetail.total")}</span>
            <Currency amountMinor={total} currency={booking.currency ?? "TZS"} />
          </li>
          <li className="flex justify-between">
            <span className="text-muted">{t("bookingDetail.paid")}</span>
            <Currency amountMinor={paid} currency={booking.currency ?? "TZS"} />
          </li>
          <li className="flex justify-between font-semibold">
            <span>{t("bookingDetail.balance")}</span>
            <Currency
              amountMinor={booking.balanceMinor ?? total - paid}
              currency={booking.currency ?? "TZS"}
            />
          </li>
        </ul>
      </Section>

      <Section title={t("bookingDetail.inspections")}>
        <EmptyState
          title={t("bookingDetail.inspections")}
          description={t("bookingDetail.inspectionsEmpty")}
        />
      </Section>

      <Section title={t("bookingDetail.opsNotes")}>
        <ul className="flex flex-col gap-2">
          {allNotes.map((n, i) => (
            <li key={i} className="rounded-input bg-canvas px-3 py-2 text-sm">
              <p>{n.text}</p>
              {n.at ? (
                <p className="mt-0.5 text-xs tabular-nums text-muted">{formatDate(n.at)}</p>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <Input
            aria-label={t("bookingDetail.opsNotes")}
            placeholder={t("bookingDetail.notesPlaceholder")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <span title={t("bookingDetail.notesDisabled")}>
            <Button size="sm" onClick={postNote}>
              {t("bookingDetail.addNote")}
            </Button>
          </span>
        </div>
      </Section>

      <Section title={t("bookingDetail.activityLog")}>
        {activity.length === 0 ? (
          <p className="text-sm text-muted">{t("bookingDetail.activityEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {activity.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="font-medium">{a.status}</span>
                <span className="text-xs tabular-nums text-muted">{formatDate(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Modal open={quoteOpen} onClose={() => setQuoteOpen(false)} title={t("quotes.createQuote")}>
        <Input
          label={t("quotes.colTotal")}
          inputMode="numeric"
          value={quoteTotal}
          onChange={(e) => setQuoteTotal(e.target.value)}
          placeholder={String(booking.totalMinor)}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setQuoteOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={createQuote} loading={quotes.create.isPending}>
            {t("common.confirm")}
          </Button>
        </div>
      </Modal>

      <Drawer open={assignOpen} onClose={() => setAssignOpen(false)} title={t("jobs.assignCrew")}>
        <AssignmentPicker
          employees={employees.list.data ?? []}
          teams={teams}
          selectedTeamId={teamId}
          selectedEmployeeIds={employeeIds}
          onTeamChange={setTeamId}
          onEmployeesChange={setEmployeeIds}
          loading={employees.list.isPending}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setAssignOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={confirmAssign}
            loading={jobs.assignEmployeesToJob.isPending || jobs.assignTeamToJob.isPending}
          >
            {t("common.confirm")}
          </Button>
        </div>
      </Drawer>
    </div>
  );
}
