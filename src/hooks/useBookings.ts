"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ActionResult,
  Booking,
  BookingFilters,
  BookingListData,
} from "@/lib/trackf-types";
import {
  createBookingAction,
  listBookingsAction,
} from "@/app/actions/bookings.actions";
import type { Booking as ServiceBooking } from "@/services/bookings.service";

const UI_TO_SERVICE_STATUS: Record<string, string> = {
  pending: "NEW",
  confirmed: "CONFIRMED",
  quote_sent: "QUOTE_SENT",
  quote_approved: "AWAITING_CUSTOMER",
  scheduled: "SCHEDULED",
  assigned: "ASSIGNED",
  en_route: "EN_ROUTE",
  arrived: "ARRIVED",
  in_progress: "IN_PROGRESS",
  completed: "COMPLETED",
  invoiced: "PAYMENT_PENDING",
  paid: "PAID",
  cancelled: "CANCELLED",
  rejected: "REJECTED",
};

const SERVICE_TO_UI_STATUS: Record<string, string> = {
  NEW: "pending",
  PENDING_REVIEW: "pending",
  QUOTE_REQUIRED: "quote_sent",
  QUOTE_SENT: "quote_sent",
  AWAITING_CUSTOMER: "quote_approved",
  CONFIRMED: "confirmed",
  SCHEDULED: "scheduled",
  ASSIGNED: "assigned",
  EN_ROUTE: "en_route",
  ARRIVED: "arrived",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  PAYMENT_PENDING: "invoiced",
  PAID: "paid",
  CANCELLED: "cancelled",
  REJECTED: "rejected",
};

export function mapServiceBooking(row: ServiceBooking): Booking {
  return {
    id: row.id,
    reference: row.reference,
    status: SERVICE_TO_UI_STATUS[row.status] ?? row.status.toLowerCase(),
    customerName: "",
    serviceName: "",
    serviceId: row.service_id ?? undefined,
    date: row.scheduled_at ?? row.created_at,
    ward: row.ward ?? undefined,
    address: row.address ?? undefined,
    branchId: row.branch_id ?? undefined,
    totalMinor: row.amount_minor,
    currency: row.currency,
  };
}

function toServiceFilter(filters: BookingFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (filters.search) out.search = filters.search;
  if (filters.from) out.from = filters.from;
  if (filters.to) out.to = filters.to;
  if (filters.branchId) out.branchId = filters.branchId;
  if (filters.status) {
    const mapped = UI_TO_SERVICE_STATUS[filters.status];
    if (mapped) out.status = mapped;
  }
  return out;
}

export { UI_TO_SERVICE_STATUS as uiToServiceBookingStatus };

export function useBookings(tenantId: string, filters: BookingFilters) {
  const query = useQuery({
    queryKey: ["bookings", tenantId, filters],
    queryFn: async (): Promise<BookingListData> => {
      const res = (await listBookingsAction(
        tenantId,
        toServiceFilter(filters),
      )) as ActionResult<ServiceBooking[]>;
      if (!res.ok) throw new Error(res.error);
      const rows = res.data.map(mapServiceBooking);
      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;
      return { rows, total: rows.length, page, pageSize };
    },
    enabled: tenantId.length > 0,
    staleTime: 15_000,
  });

  const client = useQueryClient();
  const create = useMutation({
    mutationFn: async (input: Record<string, unknown>): Promise<Booking> => {
      const res = (await createBookingAction(
        tenantId,
        input,
      )) as ActionResult<ServiceBooking>;
      if (!res.ok) throw new Error(res.error);
      return mapServiceBooking(res.data);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["bookings", tenantId] }),
  });

  return { ...query, create };
}
