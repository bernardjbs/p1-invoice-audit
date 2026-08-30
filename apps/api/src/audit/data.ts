import { sql } from '../db/client'
import type { AuditInput } from './types'

/**
 * Assembles an engine's input for one invoice from the database (plan T6).
 * Postgres `numeric` columns arrive as strings via postgres.js, so every money
 * field is coerced to a number here — the engines are pure over numbers.
 * `auditInvoice` accepts an injected loader, so the seam and its contract test
 * never depend on this DB path.
 */
export const loadAuditInput: (invoiceId: string) => Promise<AuditInput> = async (invoiceId) => {
  const [invoice] = await sql<
    {
      id: string
      invoice_number: string
      subtotal_aud: string
      gst_aud: string
      total_aud: string
      contract_id: string | null
      vendor_name: string
      vendor_is_approved: boolean
      po_number: string
      po_total_aud: string
    }[]
  >`
    select i.id, i.invoice_number, i.subtotal_aud, i.gst_aud, i.total_aud, i.contract_id,
           v.name as vendor_name, v.is_approved as vendor_is_approved,
           po.po_number, po.total_aud as po_total_aud
    from invoices i
    join vendors v on v.id = i.vendor_id
    join purchase_orders po on po.id = i.po_id
    where i.id = ${invoiceId}`
  if (!invoice) throw new Error(`invoice ${invoiceId} not found`)

  const lines = await sql<
    { item_code: string; description: string; qty: string; unit_price_aud: string; line_total_aud: string }[]
  >`
    select item_code, description, qty, unit_price_aud, line_total_aud
    from invoice_lines where invoice_id = ${invoiceId} order by item_code`

  const contractRates = invoice.contract_id
    ? await sql<{ item_code: string; rate_aud: string }[]>`
        select item_code, rate_aud from contract_rates where contract_id = ${invoice.contract_id}`
    : []

  return {
    invoice: {
      id: invoice.id,
      invoiceNumber: invoice.invoice_number,
      subtotalAud: Number(invoice.subtotal_aud),
      gstAud: Number(invoice.gst_aud),
      totalAud: Number(invoice.total_aud),
    },
    lines: lines.map((l) => ({
      itemCode: l.item_code,
      description: l.description,
      qty: Number(l.qty),
      unitPriceAud: Number(l.unit_price_aud),
      lineTotalAud: Number(l.line_total_aud),
    })),
    contractRates: contractRates.map((r) => ({ itemCode: r.item_code, rateAud: Number(r.rate_aud) })),
    po: { poNumber: invoice.po_number, totalAud: Number(invoice.po_total_aud) },
    vendor: { name: invoice.vendor_name, isApproved: invoice.vendor_is_approved },
  }
}
