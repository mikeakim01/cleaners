"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AdminTenantRow,
  PlatformAuditRow,
  PlatformPlan,
  PlatformStats,
  PlanInput,
  TenantDetailData,
} from "@/lib/admin-mappers";
import {
  mapAuditRows,
  mapPlans,
  mapTenantDetail,
  mapTenantRows,
} from "@/lib/admin-mappers";
import {
  createPlanAction,
  deactivatePlanAction,
  getPlatformStatsAction,
  getTenantDetailAction,
  listAllTenantsAction,
  listPlansAction,
  listPlatformAuditAction,
  processTrialExpiriesAction,
  setTenantSuspendedAction,
  updatePlanAction,
} from "@/app/actions/admin.actions";

export function usePlatformStats() {
  return useQuery({
    queryKey: ["admin", "stats"],
    queryFn: async (): Promise<PlatformStats> => {
      const res = await getPlatformStatsAction();
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    staleTime: 15_000,
  });
}

export function useAllTenants(search: string) {
  return useQuery({
    queryKey: ["admin", "tenants", search],
    queryFn: async (): Promise<AdminTenantRow[]> => {
      const res = await listAllTenantsAction(
        search ? { search } : {},
      );
      if (!res.ok) throw new Error(res.error);
      return mapTenantRows(res.data);
    },
    staleTime: 15_000,
  });
}

export function useTenantDetail(tenantId: string) {
  return useQuery({
    queryKey: ["admin", "tenant", tenantId],
    queryFn: async (): Promise<TenantDetailData> => {
      const res = await getTenantDetailAction(tenantId);
      if (!res.ok) throw new Error(res.error);
      return mapTenantDetail(res.data);
    },
    enabled: tenantId.length > 0,
    staleTime: 15_000,
  });
}

export function usePlans() {
  return useQuery({
    queryKey: ["admin", "plans"],
    queryFn: async (): Promise<PlatformPlan[]> => {
      const res = await listPlansAction();
      if (!res.ok) throw new Error(res.error);
      return mapPlans(res.data);
    },
    staleTime: 15_000,
  });
}

export function usePlatformAudit() {
  return useQuery({
    queryKey: ["admin", "audit"],
    queryFn: async (): Promise<PlatformAuditRow[]> => {
      const res = await listPlatformAuditAction();
      if (!res.ok) throw new Error(res.error);
      return mapAuditRows(res.data);
    },
    staleTime: 15_000,
  });
}

export function useAdminMutations() {
  const client = useQueryClient();
  const invalidateAll = () => {
    void client.invalidateQueries({ queryKey: ["admin"] });
  };

  const setSuspended = useMutation({
    mutationFn: async (input: {
      tenantId: string;
      suspended: boolean;
    }): Promise<void> => {
      const res = await setTenantSuspendedAction(input.tenantId, {
        suspended: input.suspended,
      });
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => invalidateAll(),
  });

  const createPlan = useMutation({
    mutationFn: async (input: PlanInput): Promise<void> => {
      const res = await createPlanAction(input);
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => invalidateAll(),
  });

  const updatePlan = useMutation({
    mutationFn: async (input: {
      planId: string;
      values: PlanInput;
    }): Promise<void> => {
      const res = await updatePlanAction({ planId: input.planId, ...input.values });
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => invalidateAll(),
  });

  const deactivatePlan = useMutation({
    mutationFn: async (planId: string): Promise<void> => {
      const res = await deactivatePlanAction(planId);
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => invalidateAll(),
  });

  const processExpiries = useMutation({
    mutationFn: async (): Promise<number> => {
      const res = await processTrialExpiriesAction();
      if (!res.ok) throw new Error(res.error);
      return res.data.processed;
    },
    onSuccess: () => invalidateAll(),
  });

  return {
    setSuspended,
    createPlan,
    updatePlan,
    deactivatePlan,
    processExpiries,
  };
}
