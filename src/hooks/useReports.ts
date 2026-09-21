"use client";

import { useQuery } from "@tanstack/react-query";
import type {
  FinancialSummary,
  ReportRange,
} from "@/lib/tracki-types";
import { mapFinancialSummary } from "@/lib/finance-mappers";
import { getFinancialSummaryAction } from "@/app/actions/reports.actions";

export function useFinancialSummary(tenantId: string, range: ReportRange) {
  return useQuery({
    queryKey: ["financial-summary", tenantId, range],
    queryFn: async (): Promise<FinancialSummary> => {
      const res = await getFinancialSummaryAction(tenantId, {
        from: range.from ?? "",
        to: range.to ?? "",
      });
      if (!res.ok) throw new Error(res.error);
      return mapFinancialSummary(res.data);
    },
    enabled: tenantId.length > 0,
    staleTime: 15_000,
  });
}
