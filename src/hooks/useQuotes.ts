"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActionResult, Quote } from "@/lib/trackf-types";
import { toPaged } from "@/lib/trackf-types";
import {
  approveQuoteAction,
  createQuoteAction,
  listQuotesAction,
  sendQuoteAction,
} from "@/app/actions/quotes.actions";
import { getBookingByReferenceAction } from "@/app/actions/bookings.actions";
import type { Quote as ServiceQuote } from "@/services/quotes.service";
import type { Booking as ServiceBooking } from "@/services/bookings.service";

export function mapServiceQuote(row: ServiceQuote): Quote {
  return {
    id: row.id,
    reference: row.reference,
    bookingReference: row.booking_id,
    customerName: "",
    totalMinor: row.total_minor,
    currency: "TZS",
    status: row.status.toLowerCase(),
  };
}

export interface CreateQuoteInput {
  bookingReference: string;
  totalMinor: number;
}

export function useQuotes(tenantId: string) {
  const list = useQuery({
    queryKey: ["quotes", tenantId],
    queryFn: async (): Promise<Quote[]> => {
      const res = (await listQuotesAction(
        tenantId,
        {},
      )) as ActionResult<ServiceQuote[]>;
      if (!res.ok) throw new Error(res.error);
      return toPaged<ServiceQuote>(res.data).rows.map(mapServiceQuote);
    },
    enabled: tenantId.length > 0,
    staleTime: 15_000,
  });

  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: ["quotes", tenantId] });

  const create = useMutation({
    mutationFn: async (input: CreateQuoteInput): Promise<Quote> => {
      const bookingRes = (await getBookingByReferenceAction(
        tenantId,
        input.bookingReference,
      )) as ActionResult<ServiceBooking>;
      if (!bookingRes.ok) throw new Error(bookingRes.error);
      const bookingId = bookingRes.data.id;
      const total = Math.max(0, Math.floor(input.totalMinor));
      const res = (await createQuoteAction(tenantId, bookingId, {
        items: [{ description: `Booking ${input.bookingReference}`, qty: 1, unitMinor: total }],
        discountMinor: 0,
      })) as ActionResult<ServiceQuote>;
      if (!res.ok) throw new Error(res.error);
      return { ...mapServiceQuote(res.data), bookingReference: input.bookingReference };
    },
    onSuccess: invalidate,
  });

  const send = useMutation({
    mutationFn: async (id: string): Promise<Quote> => {
      const res = (await sendQuoteAction(tenantId, id)) as ActionResult<ServiceQuote>;
      if (!res.ok) throw new Error(res.error);
      return mapServiceQuote(res.data);
    },
    onSuccess: invalidate,
  });

  const approve = useMutation({
    mutationFn: async (id: string): Promise<Quote> => {
      const res = (await approveQuoteAction(tenantId, id)) as ActionResult<ServiceQuote>;
      if (!res.ok) throw new Error(res.error);
      return mapServiceQuote(res.data);
    },
    onSuccess: invalidate,
  });

  return { list, create, send, approve };
}
