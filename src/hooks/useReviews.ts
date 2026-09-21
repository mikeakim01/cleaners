"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getReviewSummaryAction,
  listReviewsAction,
  respondToReviewAction,
} from "@/app/actions/reviews.actions";
import {
  mapStaffReview,
  type ReviewSummary,
  type StaffReview,
} from "@/lib/portal-mappers";

export type { StaffReview, ReviewSummary };

export function useReviews(tenantId: string) {
  const query = useQuery({
    queryKey: ["reviews", tenantId],
    queryFn: async (): Promise<StaffReview[]> => {
      const res = await listReviewsAction(tenantId, {});
      if (!res.ok) throw new Error(res.error);
      return res.data.map(mapStaffReview);
    },
    enabled: tenantId.length > 0,
    staleTime: 15_000,
  });

  const client = useQueryClient();
  const invalidate = () =>
    client.invalidateQueries({ queryKey: ["reviews", tenantId] });

  const respond = useMutation({
    mutationFn: async (input: { reviewId: string; response: string }) => {
      const res = await respondToReviewAction(tenantId, input);
      if (!res.ok) throw new Error(res.error);
      return mapStaffReview(res.data);
    },
    onSuccess: () => {
      void invalidate();
    },
  });

  return { ...query, respond };
}

export function useReviewSummary(tenantId: string) {
  return useQuery({
    queryKey: ["review-summary", tenantId],
    queryFn: async (): Promise<ReviewSummary> => {
      const res = await getReviewSummaryAction(tenantId);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    enabled: tenantId.length > 0,
    staleTime: 30_000,
  });
}
