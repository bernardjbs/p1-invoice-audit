import '../src/config/load-env'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql } from '../src/db/client'

/**
 * The answer key for invoice extraction.
 * Plan: 2026-09-04-p1-phase-b-langgraph-engine, task T3.
 *
 * Because the data is synthetic we KNOW what every invoice says, so extraction
 * accuracy can be measured rather than eyeballed — that is the whole reason the
 * oracle gate is possible.
 *
 * Derived from the DATABASE rather than from the seed source, deliberately: the
 * PDFs are rendered from these rows, so the rows are what the model is actually
 * being asked to read back. Reading the intent in the source would let a
 * generator bug pass unnoticed.
 *
 * Row ids are excluded — they are random per seed run, and including them would
 * make the committed file churn on every reseed for no informational gain.
 *
 * Run: `doppler run -c dev -- bun run seed` (this runs last), or on its own with
 * `bun run invoices:truth`.
 */

type InvoiceTruthRow = {
  invoice_number: string
  vendor_name: string
  abn: string | null
  invoice_date: string | null
  due_date: string | null
  subtotal_aud: string
  gst_aud: string
  total_aud: string
  po_number: string | null
  msa_ref: string | null
}

type LineTruthRow = {
  invoice_number: string
  item_code: string | null
  description: string | null
  qty: string
  unit_price_aud: string
  line_total_aud: string
}

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../assets/invoices')

async function main(): Promise<void> {
  const invoices = await sql<InvoiceTruthRow[]>`
    select i.invoice_number, v.name as vendor_name, v.abn,
           i.invoice_date::text, i.due_date::text,
           i.subtotal_aud::text, i.gst_aud::text, i.total_aud::text,
           po.po_number, c.msa_ref
    from invoices i
    join vendors v on v.id = i.vendor_id
    left join purchase_orders po on po.id = i.po_id
    left join contracts c on c.id = i.contract_id
    order by i.invoice_number`

  const lines = await sql<LineTruthRow[]>`
    select i.invoice_number, l.item_code, l.description,
           l.qty::text, l.unit_price_aud::text, l.line_total_aud::text
    from invoice_lines l
    join invoices i on i.id = l.invoice_id
    order by i.invoice_number, l.item_code`

  const linesByInvoice = new Map<string, LineTruthRow[]>()
  for (const line of lines) {
    const bucket = linesByInvoice.get(line.invoice_number) ?? []
    bucket.push(line)
    linesByInvoice.set(line.invoice_number, bucket)
  }

  const truth = {
    note:
      'Answer key for invoice extraction, derived from the seeded database. ' +
      'Generated — do not hand-edit; regenerate with `bun run invoices:truth`.',
    invoices: invoices.map((inv) => ({
      invoiceNumber: inv.invoice_number,
      vendorName: inv.vendor_name,
      abn: inv.abn,
      invoiceDate: inv.invoice_date,
      dueDate: inv.due_date,
      poNumber: inv.po_number,
      msaRef: inv.msa_ref,
      subtotalAud: Number(inv.subtotal_aud),
      gstAud: Number(inv.gst_aud),
      totalAud: Number(inv.total_aud),
      lines: (linesByInvoice.get(inv.invoice_number) ?? []).map((l) => ({
        itemCode: l.item_code,
        description: l.description,
        qty: Number(l.qty),
        unitPriceAud: Number(l.unit_price_aud),
        lineTotalAud: Number(l.line_total_aud),
      })),
    })),
  }

  mkdirSync(outDir, { recursive: true })
  writeFileSync(resolve(outDir, 'ground-truth.json'), `${JSON.stringify(truth, null, 2)}\n`, 'utf8')
  console.log(`invoices: wrote extraction ground truth for ${truth.invoices.length} invoices`)
}

try {
  await main()
} finally {
  await sql.end()
}
