"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActionResult, BookingFilters, Job, Paged } from "@/lib/trackf-types";
import { toPaged } from "@/lib/trackf-types";
import {
  assignEmployeesAction,
  assignTeamAction,
  createJobFromBookingAction,
  listJobsAction,
  updateJobStatusAction,
} from "@/app/actions/jobs.actions";
import { getBookingByReferenceAction } from "@/app/actions/bookings.actions";
import type { Job as ServiceJob } from "@/services/jobs.service";
import type { Booking as ServiceBooking } from "@/services/bookings.service";

export function mapServiceJob(row: ServiceJob): Job {
  return {
    id: row.id,
    reference: row.id.slice(0, 8),
    bookingReference: row.booking_id,
    customerName: "",
    serviceName: "",
    slot: row.scheduled_at ?? undefined,
    address: undefined,
    status: row.status.toLowerCase(),
    teamId: row.team_id ?? undefined,
    teamName: undefined,
    assigneeNames: [],
  };
}

const UI_TO_SERVICE_JOB_STATUS: Record<string, string> = {
  scheduled: "SCHEDULED",
  assigned: "ASSIGNED",
  en_route: "EN_ROUTE",
  in_progress: "IN_PROGRESS",
  completed: "COMPLETED",
  cancelled: "CANCELLED",
};

function toServiceJobStatus(to: string): string {
  return UI_TO_SERVICE_JOB_STATUS[to] ?? to.toUpperCase();
}

function toServiceJobFilter(filters: BookingFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (filters.status) {
    const mapped = UI_TO_SERVICE_JOB_STATUS[filters.status];
    if (mapped) out.status = mapped;
  }
  if (filters.branchId) out.teamId = undefined;
  return out;
}

export function useJobs(tenantId: string, filters?: BookingFilters) {
  const list = useQuery({
    queryKey: ["jobs", tenantId, filters ?? {}],
    queryFn: async (): Promise<Paged<Job>> => {
      const res = (await listJobsAction(
        tenantId,
        toServiceJobFilter(filters ?? {}),
      )) as ActionResult<ServiceJob[]>;
      if (!res.ok) throw new Error(res.error);
      const rows = toPaged<ServiceJob>(res.data).rows.map(mapServiceJob);
      return { rows, total: rows.length, page: 1, pageSize: rows.length || 20 };
    },
    enabled: tenantId.length > 0,
    staleTime: 15_000,
  });

  const client = useQueryClient();
  const invalidate = () => {
    client.invalidateQueries({ queryKey: ["jobs", tenantId] });
    client.invalidateQueries({ queryKey: ["bookings", tenantId] });
  };

  const createFromBooking = useMutation({
    mutationFn: async (bookingReference: string): Promise<Job> => {
      const bookingRes = (await getBookingByReferenceAction(
        tenantId,
        bookingReference,
      )) as ActionResult<ServiceBooking>;
      if (!bookingRes.ok) throw new Error(bookingRes.error);
      const res = (await createJobFromBookingAction(
        tenantId,
        bookingRes.data.id,
        {},
      )) as ActionResult<ServiceJob>;
      if (!res.ok) throw new Error(res.error);
      return mapServiceJob(res.data);
    },
    onSuccess: invalidate,
  });

  const assignTeamToJob = useMutation({
    mutationFn: async (input: { jobId: string; teamId: string }): Promise<Job> => {
      const res = (await assignTeamAction(
        tenantId,
        input.jobId,
        input.teamId,
      )) as ActionResult<ServiceJob>;
      if (!res.ok) throw new Error(res.error);
      return mapServiceJob(res.data);
    },
    onSuccess: invalidate,
  });

  const assignEmployeesToJob = useMutation({
    mutationFn: async (input: { jobId: string; employeeIds: string[] }): Promise<Job> => {
      const res = (await assignEmployeesAction(
        tenantId,
        input.jobId,
        input.employeeIds,
      )) as ActionResult<ServiceJob>;
      if (!res.ok) throw new Error(res.error);
      return mapServiceJob(res.data);
    },
    onSuccess: invalidate,
  });

  const advance = useMutation({
    mutationFn: async (input: { jobId: string; to: string }): Promise<Job> => {
      const res = (await updateJobStatusAction(
        tenantId,
        input.jobId,
        toServiceJobStatus(input.to),
      )) as ActionResult<ServiceJob>;
      if (!res.ok) throw new Error(res.error);
      return mapServiceJob(res.data);
    },
    onSuccess: invalidate,
  });

  return { list, createFromBooking, assignTeamToJob, assignEmployeesToJob, advance };
}
