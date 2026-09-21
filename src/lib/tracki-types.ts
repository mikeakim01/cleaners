/**
 * Shared display-only types for Phase 3 Track I (invoicing & payments).
 * Shapes mirror the server-action envelopes owned by the sibling track:
 *   @/app/actions/invoices.actions, payments.actions, reports.actions
 * No business rules live here — field mapping only.
 */
import type { ActionResult } from "./trackf-types";

export type { ActionResult };

export const INVOICE_STATUSES = [
  "draft",
  "sent",
  "partial",
  "paid",
  "void",
  "overdue",
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_PROVIDERS = [
  "cash",
  "bank_transfer",
  "mobile_money",
  "payment_link",
  "stripe",
] as const;

export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export interface InvoiceLineItem {
  id?: string;
  description: string;
  qty: number;
  unit: string;
  rateMinor: number;
  amountMinor: number;
}

export interface InvoicePayment {
  id: string;
  amountMinor: number;
  currency?: string;
  provider: string;
  providerRef?: string;
  status: string;
  createdAt: string;
  notes?: string;
}

export interface InvoiceSummary {
  id: string;
  reference: string;
  customerName?: string;
  bookingReference?: string;
  branchName?: string;
  issueDate: string;
  dueDate?: string;
  status: string;
  currency?: string;
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
}

export interface InvoiceDetail extends InvoiceSummary {
  items: InvoiceLineItem[];
  payments: InvoicePayment[];
  subtotalMinor: number;
  discountMinor: number;
  vatMinor: number;
  surchargeMinor: number;
  notes?: string;
}

/** Envelope for getInvoiceByReferenceAction. */
export interface InvoiceDetailData {
  invoice: InvoiceDetail;
  items: InvoiceLineItem[];
  payments: InvoicePayment[];
}

export interface InvoiceListData {
  rows: InvoiceSummary[];
  total: number;
  page: number;
  pageSize: number;
  kpis?: {
    collectedMinor?: number;
    outstandingMinor?: number;
    overdueMinor?: number;
  };
}

export interface InvoiceFilters {
  search?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateInvoiceLineInput {
  description: string;
  qty: number;
  unit: string;
  rateMinor: number;
}

export interface CreateInvoiceInput {
  bookingReference?: string;
  customerName?: string;
  issueDate?: string;
  dueDate?: string;
  items: CreateInvoiceLineInput[];
  discountMinor?: number;
  surchargeMinor?: number;
  vatExempt?: boolean;
  notes?: string;
}

export interface Payment {
  id: string;
  invoiceId?: string;
  invoiceReference?: string;
  customerName?: string;
  amountMinor: number;
  currency?: string;
  provider: string;
  providerRef?: string;
  status: string;
  createdAt: string;
  notes?: string;
}

export interface PaymentListData {
  rows: Payment[];
  total: number;
}

export interface RecordPaymentInput {
  invoiceId: string;
  amountMinor: number;
  provider: string;
  providerRef?: string;
  notes?: string;
}

export interface FinancialSummaryDay {
  date: string;
  collectedMinor: number;
}

export interface FinancialSummaryStatus {
  status: string;
  count: number;
  totalMinor: number;
}

export interface FinancialSummaryBranch {
  branch: string;
  count: number;
  totalMinor: number;
}

export interface FinancialSummary {
  revenueMinor: number;
  outstandingMinor: number;
  collectedMinor: number;
  overdueMinor: number;
  byDay: FinancialSummaryDay[];
  byStatus: FinancialSummaryStatus[];
  byBranch: FinancialSummaryBranch[];
}

export interface ReportRange {
  from?: string;
  to?: string;
}
