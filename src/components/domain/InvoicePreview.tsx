import { Currency } from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { InvoiceLineItem } from "@/lib/tracki-types";

export interface InvoicePreviewBusiness {
  name: string;
  address?: string;
  tin?: string;
}

export interface InvoicePreviewData {
  reference: string;
  issueDate: string;
  dueDate?: string;
  status: string;
  customerName?: string;
  customerAddress?: string;
  currency?: string;
  items: InvoiceLineItem[];
  subtotalMinor: number;
  discountMinor: number;
  vatMinor: number;
  surchargeMinor: number;
  totalMinor: number;
  paidMinor?: number;
  balanceMinor?: number;
  notes?: string;
}

export interface InvoicePreviewChannels {
  mpesaLipaNamba?: string;
  bankName?: string;
  bankAccount?: string;
}

export interface InvoicePreviewProps {
  business: InvoicePreviewBusiness;
  invoice: InvoicePreviewData;
  channels?: InvoicePreviewChannels;
}

/**
 * Display-only TAX INVOICE document. All money comes from props
 * (server-returned invoice); this component computes nothing.
 */
export function InvoicePreview({ business, invoice, channels }: InvoicePreviewProps) {
  const currency = invoice.currency ?? "TZS";
  return (
    <div className="invoice-print rounded-card border border-border bg-surface p-6 text-sm text-ink">
      <div className="flex items-start justify-between gap-4 border-b-2 border-ink pb-4">
        <div>
          <p className="font-heading text-lg font-bold tracking-tight">
            {business.name}
          </p>
          {business.address ? (
            <p className="mt-0.5 text-xs text-muted">{business.address}</p>
          ) : null}
          {business.tin ? (
            <p className="text-xs text-muted">TIN: {business.tin}</p>
          ) : null}
        </div>
        <div className="text-right">
          <p className="font-heading text-base font-bold uppercase tracking-wide">
            Tax Invoice
          </p>
          <p className="mt-0.5 font-semibold tabular-nums">{invoice.reference}</p>
          <p className="text-xs text-muted">
            Issued {formatDate(invoice.issueDate)}
            {invoice.dueDate ? ` · Due ${formatDate(invoice.dueDate)}` : ""}
          </p>
        </div>
      </div>

      <div className="grid gap-3 py-4 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Billed to
          </p>
          <p className="mt-1 font-semibold">{invoice.customerName ?? "—"}</p>
          {invoice.customerAddress ? (
            <p className="text-xs text-muted">{invoice.customerAddress}</p>
          ) : null}
        </div>
        <div className="sm:text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Status
          </p>
          <p className="mt-1 font-semibold uppercase">{invoice.status}</p>
        </div>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-y border-border text-left text-[11px] uppercase tracking-wide text-muted">
            <th scope="col" className="py-2 pr-2">Description</th>
            <th scope="col" className="py-2 pr-2 text-right">Qty</th>
            <th scope="col" className="py-2 pr-2 text-left">Unit</th>
            <th scope="col" className="py-2 pr-2 text-right">Rate</th>
            <th scope="col" className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item, i) => (
            <tr key={item.id ?? `${item.description}-${i}`} className="border-b border-border last:border-0">
              <td className="py-2 pr-2">{item.description}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{item.qty}</td>
              <td className="py-2 pr-2 text-muted">{item.unit}</td>
              <td className="py-2 pr-2 text-right">
                <Currency amountMinor={item.rateMinor} currency={currency} />
              </td>
              <td className="py-2 text-right">
                <Currency amountMinor={item.amountMinor} currency={currency} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex justify-end">
        <dl className="w-full max-w-64 space-y-1.5">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Subtotal</dt>
            <dd><Currency amountMinor={invoice.subtotalMinor} currency={currency} /></dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Discount</dt>
            <dd><Currency amountMinor={invoice.discountMinor} currency={currency} /></dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">VAT (18%)</dt>
            <dd><Currency amountMinor={invoice.vatMinor} currency={currency} /></dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Transport</dt>
            <dd><Currency amountMinor={invoice.surchargeMinor} currency={currency} /></dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-border pt-2 text-base">
            <dt className="font-bold">Total</dt>
            <dd><Currency amountMinor={invoice.totalMinor} currency={currency} /></dd>
          </div>
          {typeof invoice.paidMinor === "number" ? (
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Paid</dt>
              <dd><Currency amountMinor={invoice.paidMinor} currency={currency} /></dd>
            </div>
          ) : null}
          {typeof invoice.balanceMinor === "number" ? (
            <div className="flex justify-between gap-4">
              <dt className="font-semibold">Balance</dt>
              <dd><Currency amountMinor={invoice.balanceMinor} currency={currency} /></dd>
            </div>
          ) : null}
        </dl>
      </div>

      {channels && (channels.mpesaLipaNamba || channels.bankName) ? (
        <div className="mt-4 rounded-card border border-border bg-canvas p-3 text-xs">
          <p className="font-semibold uppercase tracking-wide text-muted">Pay via</p>
          {channels.mpesaLipaNamba ? (
            <p className="mt-1">M-Pesa Lipa Namba: <span className="font-semibold tabular-nums">{channels.mpesaLipaNamba}</span></p>
          ) : null}
          {channels.bankName ? (
            <p className="mt-0.5">
              {channels.bankName}
              {channels.bankAccount ? ` · ${channels.bankAccount}` : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {invoice.notes ? (
        <p className="mt-4 text-xs text-muted">{invoice.notes}</p>
      ) : null}

      <div className="mt-8 flex items-end justify-between gap-6">
        <div className="w-48 border-t border-muted pt-1 text-xs text-muted">
          Authorised signature
        </div>
        <p className="text-[11px] text-faint">E.&amp;O.E.</p>
      </div>
    </div>
  );
}
