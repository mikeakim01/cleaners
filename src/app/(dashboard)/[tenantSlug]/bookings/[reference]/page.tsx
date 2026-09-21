import type { BookingDetail } from "@/lib/trackf-types";
import { getBookingByReferenceAction } from "@/app/actions/bookings.actions";
import { mapServiceBooking } from "@/hooks/useBookings";
import { BookingDetailClient } from "./Client";

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; reference: string }>;
}) {
  const { tenantSlug, reference } = await params;
  let initial: BookingDetail | null = null;
  try {
    const res = await getBookingByReferenceAction(tenantSlug, decodeURIComponent(reference));
    if (res.ok) {
      const base = mapServiceBooking(res.data);
      initial = {
        ...base,
        history: [],
        lineItems: [{ label: base.serviceName || "Service", amountMinor: base.totalMinor }],
        paidMinor: 0,
        balanceMinor: base.totalMinor,
        opsNotes: [],
        activity: [],
      };
    }
  } catch {
    initial = null;
  }
  return (
    <BookingDetailClient
      tenantId={tenantSlug}
      reference={decodeURIComponent(reference)}
      initial={initial}
    />
  );
}
