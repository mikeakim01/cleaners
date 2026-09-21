"use client";

import { useQuery } from "@tanstack/react-query";
import { listMyTenantsAction, getTenantAction } from "@/app/actions/tenants.actions";

export function useTenants() {
  return useQuery({
    queryKey: ["tenants", "mine"],
    queryFn: async () => {
      const res = await listMyTenantsAction();
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useTenant(slug: string) {
  return useQuery({
    queryKey: ["tenant", slug],
    queryFn: async () => {
      const res = await getTenantAction(slug);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    enabled: slug.length > 0,
    staleTime: 30_000,
  });
}
