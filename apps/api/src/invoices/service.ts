import { sql } from '../db/client'
import { signedPdfUrl, uploadInvoicePdf } from '../lib/storage'
import { readLatestAuditRun, type AuditRunView } from '../audit/runs'

/**
 * Invoice read + create services (plan T6). Thin Hono handlers (CONVENTIONS §5)
 * call these; all SQL and storage work lives here. DB `numeric` arrives as a
 * string via postgres.js, so money is coerced to number at this boundary.
 */

export type InvoiceListRow = {
  id: string
  invoiceNumber: string
  vendorName: string
  status: string
  invoiceDate: string | null
  totalAud: number
}

export async function listInvoices(status?: string): Promise<InvoiceListRow[]> {
  const rows = await sql<
    { id: string; invoice_number: string; vendor_name: string; status: string; invoice_date: string | null; total_aud: string }[]
  >`
    select i.id, i.invoice_number, v.name as vendor_name, i.status,
           i.invoice_date::text, i.total_aud
    from invoices i
    join vendors v on v.id = i.vendor_id
    ${status ? sql`where i.status = ${status}` : sql``}
    order by i.invoice_number`
  return rows.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoice_number,
    vendorName: r.vendor_name,
    status: r.status,
    invoiceDate: r.invoice_date,
    totalAud: Number(r.total_aud),
  }))
}

export type InvoiceDetail = {
  invoice: {
    id: string
    invoiceNumber: string
    status: string
    invoiceDate: string | null
    dueDate: string | null
    subtotalAud: number
    gstAud: number
    totalAud: number
  }
  vendor: { id: string; name: string; abn: string | null; isApproved: boolean }
  lines: { itemCode: string; description: string | null; qty: number; unitPriceAud: number; lineTotalAud: number }[]
  latestAudit: AuditRunView | null
  reviewDecision: { decision: string; note: string | null; decidedAt: string | null } | null
  pdfUrl: string | null
}

export async function getInvoiceDetail(id: string): Promise<InvoiceDetail | null> {
  const [inv] = await sql<
    {
      id: string
      invoice_number: string
      status: string
      invoice_date: string | null
      due_date: string | null
      subtotal_aud: string
      gst_aud: string
      total_aud: string
      pdf_path: string | null
      vendor_id: string
      vendor_name: string
      vendor_abn: string | null
      vendor_is_approved: boolean
    }[]
  >`
    select i.id, i.invoice_number, i.status, i.invoice_date::text, i.due_date::text,
           i.subtotal_aud, i.gst_aud, i.total_aud, i.pdf_path,
           v.id as vendor_id, v.name as vendor_name, v.abn as vendor_abn, v.is_approved as vendor_is_approved
    from invoices i join vendors v on v.id = i.vendor_id
    where i.id = ${id}`
  if (!inv) return null

  const lines = await sql<
    { item_code: string; description: string | null; qty: string; unit_price_aud: string; line_total_aud: string }[]
  >`
    select item_code, description, qty, unit_price_aud, line_total_aud
    from invoice_lines where invoice_id = ${id} order by item_code`

  const latestAudit: AuditRunView | null = await readLatestAuditRun(id)

  const [decision] = await sql<{ decision: string; note: string | null; decided_at: string | null }[]>`
    select decision, note, decided_at::text from review_decisions
    where invoice_id = ${id} order by decided_at desc nulls last limit 1`

  return {
    invoice: {
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      status: inv.status,
      invoiceDate: inv.invoice_date,
      dueDate: inv.due_date,
      subtotalAud: Number(inv.subtotal_aud),
      gstAud: Number(inv.gst_aud),
      totalAud: Number(inv.total_aud),
    },
    vendor: { id: inv.vendor_id, name: inv.vendor_name, abn: inv.vendor_abn, isApproved: inv.vendor_is_approved },
    lines: lines.map((l) => ({
      itemCode: l.item_code,
      description: l.description,
      qty: Number(l.qty),
      unitPriceAud: Number(l.unit_price_aud),
      lineTotalAud: Number(l.line_total_aud),
    })),
    latestAudit,
    reviewDecision: decision ? { decision: decision.decision, note: decision.note, decidedAt: decision.decided_at } : null,
    pdfUrl: await signedPdfUrl(inv.pdf_path),
  }
}

export type CreateInvoiceInput = {
  invoiceNumber: string
  vendorId: string
  poId?: string | null
  contractId?: string | null
  subtotalAud: number
  gstAud: number
  totalAud: number
  pdf: Uint8Array
}

/** Insert a received invoice and store its uploaded PDF. Returns the new id. */
export async function createInvoice(input: CreateInvoiceInput): Promise<string> {
  const pdfPath = `${input.invoiceNumber}.pdf`
  await uploadInvoicePdf(pdfPath, input.pdf)
  const [row] = await sql<{ id: string }[]>`
    insert into invoices (invoice_number, vendor_id, po_id, contract_id, subtotal_aud, gst_aud, total_aud, status, pdf_path)
    values (${input.invoiceNumber}, ${input.vendorId}, ${input.poId ?? null}, ${input.contractId ?? null},
            ${input.subtotalAud}, ${input.gstAud}, ${input.totalAud}, 'received', ${pdfPath})
    returning id`
  return row!.id
}

export async function listVendors(): Promise<{ id: string; name: string; abn: string | null; isApproved: boolean }[]> {
  const rows = await sql<{ id: string; name: string; abn: string | null; is_approved: boolean }[]>`
    select id, name, abn, is_approved from vendors order by name`
  return rows.map((r) => ({ id: r.id, name: r.name, abn: r.abn, isApproved: r.is_approved }))
}
