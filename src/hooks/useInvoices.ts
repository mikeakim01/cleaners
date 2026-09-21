"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateInvoiceInput,
  InvoiceDetailData,
  InvoiceFilters,
  InvoiceListData,
  InvoiceSummary,
} from "@/lib/tracki-types";
import {
  UI_TO_SERVICE_INVOICE_STATUS,
  mapServiceInvoice,
  mapServiceInvoiceDetail,
  toInvoiceListData,
} from "@/lib/finance-mappers";
import {
  createInvoiceAction,
  getInvoiceByReferenceAction,
  listInvoicesAction,
  sendInvoiceAction,
  voidInvoiceAction,
} from "@/app/actions/invoices.actions";

function toServiceFilter(filters: InvoiceFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (filters.search) out.search = filters.search;
  if (filters.from) out.from = filters.from;
  if (filters.to) out.to = filters.to;
  if (filters.status) {
    const mapped = UI_TO_SERVICE_INVOICE_STATUS[filters.status];
    if (mapped) out.status = mapped;
  }
  return out;
}

function toServiceInput(input: CreateInvoiceInput): Record<string, unknown> {
  return {
    bookingReference: input.bookingReference,
    dueDate: input.dueDate ?? "",
    notes: input.notes ?? "",
    discountMinor: input.discountMinor ?? 0,
    surchargeMinor: input.surchargeMinor ?? 0,
    items: input.items.map((l) => ({
      description: l.description,
      qty: l.qty,
      unitMinor: l.rateMinor,
    })),
  };
}

export function useInvoices(tenantId: string, filters: InvoiceFilters) {
  const query = useQuery({
    queryKey: ["invoices", tenantId, filters],
    queryFn: async (): Promise<InvoiceListData> => {
      const res = await listInvoicesAction(tenantId, toServiceFilter(filters));
      if (!res.ok) throw new Error(res.error);
      return toInvoiceListData(res.data);
    },
    enabled: tenantId.length > 0,
    staleTime: 15_000,
  });

  const client = useQueryClient();
  const invalidate = () =>
    client.invalidateQueries({ queryKey: ["invoices", tenantId] });

  const create = useMutation({
    mutationFn: async (input: CreateInvoiceInput): Promise<InvoiceSummary> => {
      const res = await createInvoiceAction(tenantId, toServiceInput(input));
      if (!res.ok) throw new Error(res.error);
      return mapServiceInvoice(res.data);
    },
    onSuccess: () => {
      void invalidate();
    },
  });

  const send = useMutation({
    mutationFn: async (id: string): Promise<InvoiceSummary> => {
      const res = await sendInvoiceAction(tenantId, id);
      if (!res.ok) throw new Error(res.error);
      return mapServiceInvoice(res.data);
    },
    onSuccess: () => {
      void invalidate();
    },
  });

  const voidInvoice = useMutation({
    mutationFn: async (id: string): Promise<InvoiceSummary> => {
      const res = await voidInvoiceAction(tenantId, id);
      if (!res.ok) throw new Error(res.error);
      return mapServiceInvoice(res.data);
    },
    onSuccess: () => {
      void invalidate();
    },
  });

  return { ...query, create, send, voidInvoice };
}

export function useInvoiceDetail(tenantId: string, reference: string) {
  return useQuery({
    queryKey: ["invoice", tenantId, reference],
    queryFn: async (): Promise<InvoiceDetailData> => {
      const res = await getInvoiceByReferenceAction(tenantId, reference);
      if (!res.ok) throw new Error(res.error);
      return mapServiceInvoiceDetail(res.data);
    },
    enabled: tenantId.length > 0 && reference.length > 0,
    staleTime: 15_000,
  });
}
