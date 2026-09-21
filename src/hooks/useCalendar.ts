"use client";

import { useQuery } from "@tanstack/react-query";
import type { ActionResult, Booking, DaySchedule } from "@/lib/trackf-types";
import {
  detectConflictsAction,
  getDayScheduleAction,
} from "@/app/actions/calendar.actions";
import type {
  DayScheduleBooking,
  ScheduleConflict,
} from "@/services/calendar.service";

function mapScheduleBooking(row: DayScheduleBooking): Booking {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status.toLowerCase(),
    customerName: "",
    serviceName: "",
    date: row.scheduled_at ?? "",
    totalMinor: 0,
    currency: "TZS",
  };
}

export function useCalendar(tenantId: string, dateISO: string) {
  return useQuery({
    queryKey: ["calendar", tenantId, dateISO],
    queryFn: async (): Promise<DaySchedule> => {
      const [scheduleRes, conflictsRes] = await Promise.all([
        getDayScheduleAction(tenantId, dateISO) as Promise<
          ActionResult<{ date: string; jobs: unknown[]; bookings: DayScheduleBooking[] }>
        >,
        detectConflictsAction(tenantId, dateISO) as Promise<
          ActionResult<ScheduleConflict[]>
        >,
      ]);
      if (!scheduleRes.ok) throw new Error(scheduleRes.error);
      if (!conflictsRes.ok) throw new Error(conflictsRes.error);
      return {
        date: scheduleRes.data.date,
        crews: [],
        unassigned: scheduleRes.data.bookings.map(mapScheduleBooking),
        conflicts: conflictsRes.data.map((c) => ({
          message: `Team member ${c.employeeId} has overlapping jobs: ${c.jobIds.join(", ")}`,
        })),
      };
    },
    enabled: tenantId.length > 0 && dateISO.length > 0,
    staleTime: 15_000,
  });
}
