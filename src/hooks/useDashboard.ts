"use client";

import { useQuery } from "@tanstack/react-query";
import { getDashboardAction } from "@/app/actions/dashboard.actions";

export function useDashboard(tenantId: string) {
  return useQuery({
    queryKey: ["dashboard", tenantId],
    queryFn: async () => {
      const res = await getDashboardAction(tenantId);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    enabled: tenantId.length > 0,
    staleTime: 20_000,
  });
}
