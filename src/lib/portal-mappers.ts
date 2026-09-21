/**
 * Service-to-display mappers for public site, portal and reviews (Phase 5).
 * Services speak snake_case; UI speaks camelCase. All mapping lives here —
 * never in components. Type-only service imports (erased at build), so this
 * module is safe for client components.
 */
import type {
  PortalBooking as ServicePortalBooking,
  PortalInvoice as ServicePortalInvoice,
} from "@/services/portal.service";
import type { PublicTenant as ServicePublicTenant } from "@/services/public.service";
import type { Review as ServiceReview } from "@/services/reviews.service";

export interface PublicService {
  id: string;
  name: string;
  description: string;
  pricingModel: string;
  baseMinor: number;
  unitMinor: number;
}

export interface PublicBranch {
  id: string;
  name: string;
  address: string;
  hours: string;
}

export interface PublicReviewQuote {
  customerName: string;
  rating: number;
  comment: string;
}

export interface PublicTenantData {
  tenant: {
    id: string;
    slug: string;
    name: string;
    phoneE164: string;
    primaryColor: string;
    logoUrl: string;
    address: string;
    hours: string;
  };
  branches: PublicBranch[];
  services: PublicService[];
  reviewsSummary: { avg: number; count: number };
  reviews: PublicReviewQuote[];
}

export interface PortalBooking {
  reference: string;
  serviceName: string;
  scheduledAt: string;
  status: string;
  totalMinor: number;
  balanceMinor: number;
}

export interface PortalInvoice {
  reference: string;
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  status: string;
  dueDate: string;
}

export interface StaffReview {
  id: string;
  bookingReference: string;
  customerName: string;
  rating: number;
  comment: string;
  source: string;
  response: string | null;
  createdAt: string;
}

export interface ReviewSummary {
  avg: number;
  count: number;
}

export function mapPublicTenant(t: ServicePublicTenant): PublicTenantData {
  return {
    tenant: {
      id: t.id,
      slug: t.slug,
      name: t.name,
      phoneE164: t.phone_e164 ?? "",
      primaryColor: t.primary_color,
      logoUrl: t.logo_url ?? "",
      address: t.address ?? "",
      hours: "",
    },
    branches: t.branches.map((b) => ({
      id: b.id,
      name: b.name,
      address: b.address ?? "",
      hours: "",
    })),
    services: t.services.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description ?? "",
      pricingModel: s.pricing_model,
      baseMinor: s.base_price_minor,
      unitMinor: s.unit_price_minor,
    })),
    reviewsSummary: t.reviewsSummary,
    reviews: t.reviews,
  };
}

export function mapPortalBookings(rows: ServicePortalBooking[]): PortalBooking[] {
  return rows.map((b) => ({
    reference: b.reference,
    serviceName: b.service_name ?? "",
    scheduledAt: b.scheduled_at ?? "",
    status: b.status,
    totalMinor: b.amount_minor,
    balanceMinor: b.balance_minor,
  }));
}

export function mapPortalInvoices(rows: ServicePortalInvoice[]): PortalInvoice[] {
  return rows.map((i) => ({
    reference: i.reference,
    totalMinor: i.total_minor,
    paidMinor: i.amount_paid_minor,
    balanceMinor: i.balance_minor,
    status: i.status,
    dueDate: i.due_date ?? "",
  }));
}

export function mapStaffReview(r: ServiceReview): StaffReview {
  return {
    id: r.id,
    bookingReference: r.booking_reference ?? "",
    customerName: r.customer_name ?? "",
    rating: r.rating,
    comment: r.comment ?? "",
    source: r.source,
    response: r.response,
    createdAt: r.created_at,
  };
}
