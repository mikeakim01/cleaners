import { getReviewSummaryAction, listReviewsAction } from "@/app/actions/reviews.actions";
import { mapStaffReview, type StaffReview } from "@/lib/portal-mappers";
import { ReviewsClient } from "./Client";

export default async function ReviewsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  let initial: StaffReview[] | null = null;
  let summary: { avg: number; count: number } | null = null;
  try {
    const [list, sum] = await Promise.all([
      listReviewsAction(tenantSlug, {}),
      getReviewSummaryAction(tenantSlug),
    ]);
    if (list.ok) initial = list.data.map(mapStaffReview);
    if (sum.ok) summary = sum.data;
  } catch {
    initial = null;
  }
  return <ReviewsClient tenantId={tenantSlug} initial={initial} initialSummary={summary} />;
}
