"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActionResult, BookingDetail, BookingStatus } from "@/lib/trackf-types";
import {
  getBookingByReferenceAction,
  transitionBookingByReferenceAction,
} from "@/app/actions/bookings.actions";
import type { Booking as ServiceBooking } from "@/services/bookings.service";
import { mapServiceBooking } from "./useBookings";

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
  on_hold: "IN_PROGRESS",
  quality_check: "IN_PROGRESS",
  completed: "COMPLETED",
  invoiced: "PAYMENT_PENDING",
  paid: "PAID",
  cancelled: "CANCELLED",
  rejected: "REJECTED",
};

function toServiceStatus(to: string): string {
  return UI_TO_SERVICE_STATUS[to] ?? to.toUpperCase();
}

function toDetail(row: ServiceBooking): BookingDetail {
  const base = mapServiceBooking(row);
  return {
    ...base,
    history: [],
    lineItems: [{ label: base.serviceName || "Service", amountMinor: base.totalMinor }],
    paidMinor: 0,
    balanceMinor: base.totalMinor,
    opsNotes: [],
    activity: [],
  };
}

export function useBookingDetail(tenantId: string, reference: string) {
  const query = useQuery({
    queryKey: ["booking", tenantId, reference],
    queryFn: async (): Promise<BookingDetail> => {
      const res = (await getBookingByReferenceAction(
        tenantId,
        reference,
      )) as ActionResult<ServiceBooking>;
      if (!res.ok) throw new Error(res.error);
      return toDetail(res.data);
    },
    enabled: tenantId.length > 0 && reference.length > 0,
    staleTime: 15_000,
  });

  const client = useQueryClient();
  const transition = useMutation({
    mutationFn: async (to: BookingStatus): Promise<BookingDetail> => {
      const res = (await transitionBookingByReferenceAction(
        tenantId,
        reference,
        toServiceStatus(to),
      )) as ActionResult<ServiceBooking>;
      if (!res.ok) throw new Error(res.error);
      return toDetail(res.data);
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["booking", tenantId, reference] });
      client.invalidateQueries({ queryKey: ["bookings", tenantId] });
    },
  });

  return { ...query, transition };
}

/** Bulk transitions (e.g. cancel several rows) — same action as the detail hook. */
export function useBulkTransitionBooking(tenantId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { reference: string; to: BookingStatus }): Promise<BookingDetail> => {
      const res = (await transitionBookingByReferenceAction(
        tenantId,
        input.reference,
        toServiceStatus(input.to),
      )) as ActionResult<ServiceBooking>;
      if (!res.ok) throw new Error(res.error);
      return toDetail(res.data);
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["bookings", tenantId] });
      client.invalidateQueries({ queryKey: ["booking", tenantId] });
    },
  });
}
