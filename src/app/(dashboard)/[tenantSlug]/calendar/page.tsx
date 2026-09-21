import type { DaySchedule } from "@/lib/trackf-types";
import {
  detectConflictsAction,
  getDayScheduleAction,
} from "@/app/actions/calendar.actions";
import { CalendarClient } from "./Client";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function CalendarPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const date = todayISO();
  let initial: DaySchedule | null = null;
  try {
    const [scheduleRes, conflictsRes] = await Promise.all([
      getDayScheduleAction(tenantSlug, date),
      detectConflictsAction(tenantSlug, date),
    ]);
    if (scheduleRes.ok) {
      initial = {
        date: scheduleRes.data.date,
        crews: [],
        unassigned: scheduleRes.data.bookings.map((b) => ({
          id: b.id,
          reference: b.reference,
          status: b.status.toLowerCase(),
          customerName: "",
          serviceName: "",
          date: b.scheduled_at ?? "",
          totalMinor: 0,
          currency: "TZS",
        })),
        conflicts: conflictsRes.ok
          ? conflictsRes.data.map((c) => ({
              message: `Team member ${c.employeeId} has overlapping jobs: ${c.jobIds.join(", ")}`,
            }))
          : [],
      };
    }
  } catch {
    initial = null;
  }
  return <CalendarClient tenantId={tenantSlug} initialDate={date} initial={initial} />;
}
