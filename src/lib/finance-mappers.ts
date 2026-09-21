/**
 * Service-to-display mappers for finance (Phase 3).
 * Services speak snake_case + UPPER statuses; UI (tracki-types) speaks
 * camelCase + lowercase statuses. All mapping lives here — never in
 * components. Used by hooks and dashboard server pages.
 */
import type {
  FinancialSummary,
  InvoiceDetailData,
  InvoiceListData,
  InvoicePayment,
  InvoiceStatus,
  InvoiceSummary,
  Payment,
  PaymentListData,
} from "./tracki-types";
import type {
  Invoice as ServiceInvoice,
  InvoicePayment as ServiceInvoicePayment,
} from "@/services/invoices.service";
import type { Payment as ServicePayment } from "@/services/payments.service";
import type { FinancialSummary as ServiceSummary } from "@/services/reports.service";

export const UI_TO_SERVICE_INVOICE_STATUS: Record<string, string> = {
  draft: "DRAFT",
  sent: "SENT",
  partial: "PARTIAL",
  paid: "PAID",
  void: "VOID",
  overdue: "OVERDUE",
};

export const SERVICE_TO_UI_INVOICE_STATUS: Record<string, InvoiceStatus> = {
  DRAFT: "draft",
  SENT: "sent",
  PARTIAL: "partial",
  PAID: "paid",
  VOID: "void",
  OVERDUE: "overdue",
};

export function toUiInvoiceStatus(status: string): InvoiceStatus {
  return SERVICE_TO_UI_INVOICE_STATUS[status] ?? "draft";
}

export function mapServiceInvoice(row: ServiceInvoice): InvoiceSummary {
  const balance = Math.max(0, row.total_minor - row.amount_paid_minor);
  return {
    id: row.id,
    reference: row.reference,
    customerName: row.customer_name,
    bookingReference: row.booking_reference ?? undefined,
    branchName: row.branch_name ?? undefined,
    issueDate: row.issue_date,
    dueDate: row.due_date ?? undefined,
    status: toUiInvoiceStatus(row.status),
    currency: row.currency,
    totalMinor: row.total_minor,
    paidMinor: row.amount_paid_minor,
    balanceMinor: balance,
  };
}

export function mapServiceInvoiceDetail(row: ServiceInvoice): InvoiceDetailData {
  const summary = mapServiceInvoice(row);
  const items = (row.items ?? []).map((i) => ({
    id: i.id,
    description: i.description,
    qty: Number(i.qty),
    unit: "item",
    rateMinor: i.unit_price_minor,
    amountMinor: i.total_minor,
  }));
  const payments = (row.payments ?? []).map(mapServiceInvoicePayment);
  return {
    invoice: {
      ...summary,
      items,
      payments,
      subtotalMinor: row.subtotal_minor,
      discountMinor: row.discount_minor,
      vatMinor: row.vat_minor,
      surchargeMinor: row.surcharge_minor,
      notes: row.notes ?? undefined,
    },
    items,
    payments,
  };
}

export function mapServiceInvoicePayment(p: ServiceInvoicePayment): InvoicePayment {
  return {
    id: p.id,
    amountMinor: p.amount_minor,
    provider: p.provider,
    providerRef: p.provider_ref ?? undefined,
    status: p.status.toLowerCase(),
    createdAt: p.received_at,
  };
}

export function toInvoiceListData(rows: ServiceInvoice[]): InvoiceListData {
  const mapped = rows.map(mapServiceInvoice);
  return { rows: mapped, total: mapped.length, page: 1, pageSize: 20 };
}

export function mapServicePayment(p: ServicePayment): Payment {
  return {
    id: p.id,
    invoiceId: p.invoice_id,
    amountMinor: p.amount_minor,
    provider: p.provider,
    providerRef: p.provider_ref ?? undefined,
    status: p.status.toLowerCase(),
    createdAt: p.received_at,
    notes: p.notes ?? undefined,
  };
}

export function toPaymentListData(rows: ServicePayment[]): PaymentListData {
  const mapped = rows.map(mapServicePayment);
  return { rows: mapped, total: mapped.length };
}

export function mapFinancialSummary(s: ServiceSummary): FinancialSummary {
  return {
    revenueMinor: s.revenueMinor,
    outstandingMinor: s.outstandingMinor,
    collectedMinor: s.collectedMinor,
    overdueMinor: s.overdueMinor,
    byDay: s.byDay.map((d) => ({
      date: d.date,
      collectedMinor: d.collectedMinor,
    })),
    byStatus: s.byStatus.map((b) => ({
      status: b.status.toLowerCase(),
      count: b.count,
      totalMinor: b.totalMinor,
    })),
    byBranch: s.byBranch.map((b) => ({
      branch: b.branchName ?? b.branchId,
      count: b.count,
      totalMinor: b.totalMinor,
    })),
  };
}

/** UUID test — decides invoiceId vs invoiceReference for recordPayment. */
export function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}
