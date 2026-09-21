import type { BookingListData } from "@/lib/trackf-types";
import { listBookingsAction } from "@/app/actions/bookings.actions";
import { mapServiceBooking } from "@/hooks/useBookings";
import { BookingsClient } from "./Client";

export default async function BookingsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  let initial: BookingListData | null = null;
  try {
    const res = await listBookingsAction(tenantSlug, {});
    if (res.ok) {
      const rows = res.data.map(mapServiceBooking);
      initial = { rows, total: rows.length, page: 1, pageSize: 20 };
    }
  } catch {
    initial = null;
  }
  return <BookingsClient tenantId={tenantSlug} initial={initial} />;
}
