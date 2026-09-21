"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  PaymentListData,
  RecordPaymentInput,
} from "@/lib/tracki-types";
import {
  isUuidLike,
  toPaymentListData,
} from "@/lib/finance-mappers";
import {
  listTenantPaymentsAction,
  recordPaymentAction,
} from "@/app/actions/payments.actions";

export function usePayments(tenantId: string) {
  const query = useQuery({
    queryKey: ["payments", tenantId],
    queryFn: async (): Promise<PaymentListData> => {
      const res = await listTenantPaymentsAction(tenantId, {});
      if (!res.ok) throw new Error(res.error);
      return toPaymentListData(res.data);
    },
    enabled: tenantId.length > 0,
    staleTime: 15_000,
  });

  const client = useQueryClient();
  const record = useMutation({
    mutationFn: async (input: RecordPaymentInput): Promise<{ id: string }> => {
      const res = await recordPaymentAction(tenantId, {
        ...(isUuidLike(input.invoiceId)
          ? { invoiceId: input.invoiceId }
          : { invoiceReference: input.invoiceId }),
        amountMinor: input.amountMinor,
        provider: input.provider,
        providerRef: input.providerRef,
        notes: input.notes ?? "",
      });
      if (!res.ok) throw new Error(res.error);
      return { id: res.data.payment.id };
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["payments", tenantId] });
      void client.invalidateQueries({ queryKey: ["invoices", tenantId] });
      void client.invalidateQueries({ queryKey: ["invoice", tenantId] });
      void client.invalidateQueries({
        queryKey: ["financial-summary", tenantId],
      });
    },
  });

  return { ...query, record };
}
