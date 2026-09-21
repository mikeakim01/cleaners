/**
 * Shared display-only types for Phase 2 Track F.
 * Shapes for data returned by server actions owned by sibling tracks.
 * No business rules live here — field mapping only.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** The 16 booking workflow states (BK-2417). */
export const BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "quote_sent",
  "quote_approved",
  "scheduled",
  "assigned",
  "en_route",
  "arrived",
  "in_progress",
  "on_hold",
  "quality_check",
  "completed",
  "invoiced",
  "paid",
  "cancelled",
  "rejected",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const TERMINAL_STATUSES: readonly BookingStatus[] = [
  "cancelled",
  "rejected",
] as const;

export function isTerminalStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export interface CrewMember {
  name: string;
  avatarUrl?: string;
}

export interface Booking {
  id: string;
  reference: string;
  status: string;
  customerName: string;
  customerPhone?: string;
  serviceName: string;
  serviceId?: string;
  date: string;
  timeSlot?: string;
  ward?: string;
  address?: string;
  branchId?: string;
  branchName?: string;
  totalMinor: number;
  currency?: string;
  crew?: CrewMember[];
  jobId?: string;
}

export interface BookingFilters {
  search?: string;
  status?: string;
  from?: string;
  to?: string;
  branchId?: string;
  serviceId?: string;
  page?: number;
  pageSize?: number;
}

export interface BookingsKpis {
  todayDispatch?: number;
  unassigned?: number;
  enRoute?: number;
  awaitingQuote?: number;
  collectionsPending?: number;
  slaAtRisk?: number;
}

export interface BookingListData {
  rows: Booking[];
  total: number;
  page: number;
  pageSize: number;
  kpis?: BookingsKpis;
}

export interface BookingHistoryEntry {
  status: string;
  at: string;
  actorName?: string;
  note?: string;
}

export interface PriceLineItem {
  label: string;
  amountMinor: number;
}

export interface BookingDetail extends Booking {
  history?: BookingHistoryEntry[];
  lineItems?: PriceLineItem[];
  propertyProfile?: { label: string; value: string }[];
  siteLocationUrl?: string;
  paidMinor?: number;
  balanceMinor?: number;
  opsNotes?: { author?: string; at?: string; text: string }[];
  activity?: BookingHistoryEntry[];
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  ward?: string;
  bookingsCount?: number;
  totalSpentMinor?: number;
  currency?: string;
}

export interface ServiceItem {
  id: string;
  name: string;
  pricingModel: string;
  baseMinor: number;
  unitMinor?: number;
  unitLabel?: string;
  currency?: string;
  active?: boolean;
}

export interface Quote {
  id: string;
  reference: string;
  bookingReference?: string;
  customerName?: string;
  totalMinor: number;
  currency?: string;
  status: string;
}

export interface Job {
  id: string;
  reference: string;
  bookingReference?: string;
  customerName?: string;
  serviceName?: string;
  slot?: string;
  address?: string;
  status: string;
  teamId?: string;
  teamName?: string;
  assigneeNames?: string[];
}

export interface Employee {
  id: string;
  name: string;
  phone?: string;
  role?: string;
  teamId?: string;
  teamName?: string;
  avatarUrl?: string;
  active?: boolean;
}

export interface Team {
  id: string;
  name: string;
  memberCount: number;
}

export interface CrewCapacity {
  teamId: string;
  teamName: string;
  capacity: number;
  booked: number;
}

export interface DaySchedule {
  date: string;
  crews?: CrewCapacity[];
  unassigned?: Booking[];
  conflicts?: { message: string }[];
}

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Accept either a bare array or a paged envelope from a list action. */
export function toPaged<T>(data: unknown): Paged<T> {
  if (Array.isArray(data)) {
    return { rows: data as T[], total: data.length, page: 1, pageSize: data.length };
  }
  const d = (data ?? {}) as Partial<Paged<T>>;
  return {
    rows: Array.isArray(d.rows) ? d.rows : [],
    total: typeof d.total === "number" ? d.total : 0,
    page: typeof d.page === "number" ? d.page : 1,
    pageSize: typeof d.pageSize === "number" ? d.pageSize : 20,
  };
}
