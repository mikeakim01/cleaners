"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BillingStateData, TrialInfo } from "@/lib/admin-mappers";
import { mapBillingState } from "@/lib/admin-mappers";
import {
  cancelSubscriptionAction,
  changePlanAction,
  getBillingStateAction,
  getTrialInfoAction,
  recordSubscriptionPaymentAction,
} from "@/app/actions/billing.actions";

export function useBillingState(tenantId: string) {
  return useQuery({
    queryKey: ["billing", tenantId],
    queryFn: async (): Promise<BillingStateData> => {
      const res = await getBillingStateAction(tenantId);
      if (!res.ok) throw new Error(res.error);
      return mapBillingState(res.data);
    },
    enabled: tenantId.length > 0,
    staleTime: 15_000,
  });
}

export function useTrialInfo(tenantId: string) {
  return useQuery({
    queryKey: ["trial", tenantId],
    queryFn: async (): Promise<TrialInfo> => {
      const res = await getTrialInfoAction(tenantId);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    enabled: tenantId.length > 0,
    staleTime: 30_000,
  });
}

export function useBillingMutations(tenantId: string) {
  const client = useQueryClient();
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ["billing", tenantId] });
    void client.invalidateQueries({ queryKey: ["trial", tenantId] });
  };

  const changePlan = useMutation({
    mutationFn: async (planId: string): Promise<void> => {
      const res = await changePlanAction(tenantId, { planId });
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => invalidate(),
  });

  const recordPayment = useMutation({
    mutationFn: async (input: {
      amountMinor: number;
      provider: string;
      providerRef?: string;
    }): Promise<void> => {
      const res = await recordSubscriptionPaymentAction(tenantId, input);
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => invalidate(),
  });

  const cancel = useMutation({
    mutationFn: async (): Promise<void> => {
      const res = await cancelSubscriptionAction(tenantId);
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => invalidate(),
  });

  return { changePlan, recordPayment, cancel };
}
