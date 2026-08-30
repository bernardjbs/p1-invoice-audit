import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
import postgres from 'postgres'

// Load the repo-root .env.local (SUPABASE_URL / service-role key) — under
// `bun run --filter`, the child's cwd is apps/api, so Bun's implicit .env
// loading misses the root file. Best-effort: falls back to local defaults.
try {
  process.loadEnvFile(resolve(import.meta.dirname, '../../../.env.local'))
} catch {
  // no .env.local (bare checkout) — SUPABASE_SERVICE_ROLE_KEY guard below applies.
}

/**
 * Generate a PDF for every seeded invoice (plan T4, criterion 3), upload it to
 * the private `invoices` storage bucket, and write its object path back onto the
 * invoice row. Runs as the second half of `bun run seed`, after the row seed.
 *
 * Idempotent: the object path is derived from the invoice number and uploaded
 * with `upsert`, and `pdf_path` is overwritten — so reset+seed or a re-run lands
 * the same end state. Local Supabase only; keys are the well-known local
 * defaults (see .env.local), read from the env with local fallbacks.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const BUCKET = 'invoices'

const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })
const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

type InvoiceRow = {
  id: string
  invoice_number: string
  invoice_date: string
  due_date: string
  subtotal_aud: number
  gst_aud: number
  total_aud: number
  vendor_name: string
  vendor_abn: string
}
type LineRow = {
  invoice_id: string
  item_code: string
  description: string
  qty: number
  unit_price_aud: number
  line_total_aud: number
}

function renderHtml(inv: InvoiceRow, lines: LineRow[]): string {
  const rows = lines
    .map(
      (l) => `<tr>
        <td>${esc(l.item_code)}</td>
        <td>${esc(l.description)}</td>
        <td class="num">${l.qty}</td>
        <td class="num">${aud.format(l.unit_price_aud)}</td>
        <td class="num">${aud.format(l.line_total_aud)}</td>
      </tr>`,
    )
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; font-size: 12px; margin: 32px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .meta { margin: 12px 0 20px; }
    .meta div { margin: 2px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
    th { background: #f0f4f8; }
    .num { text-align: right; }
    tfoot td { font-weight: bold; }
  </style></head><body>
    <h1>Tax Invoice</h1>
    <div class="meta">
      <div><strong>Invoice:</strong> ${esc(inv.invoice_number)}</div>
      <div><strong>Vendor:</strong> ${esc(inv.vendor_name)}</div>
      <div><strong>ABN:</strong> ${esc(inv.vendor_abn)}</div>
      <div><strong>Invoice date:</strong> ${esc(inv.invoice_date)} &nbsp; <strong>Due:</strong> ${esc(inv.due_date)}</div>
    </div>
    <table>
      <thead><tr><th>Code</th><th>Description</th><th class="num">Qty</th><th class="num">Unit (AUD)</th><th class="num">Line (AUD)</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="4" class="num">Subtotal</td><td class="num">${aud.format(inv.subtotal_aud)}</td></tr>
        <tr><td colspan="4" class="num">GST (10%)</td><td class="num">${aud.format(inv.gst_aud)}</td></tr>
        <tr><td colspan="4" class="num">Total</td><td class="num">${aud.format(inv.total_aud)}</td></tr>
      </tfoot>
    </table>
  </body></html>`
}

async function main(): Promise<void> {
  if (!SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to upload PDFs')
  const sql = postgres(DATABASE_URL, { max: 1 })
  const storage = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  }).storage.from(BUCKET)
  const browser = await chromium.launch()

  try {
    const invoices = await sql<InvoiceRow[]>`
      select i.id, i.invoice_number, i.invoice_date::text, i.due_date::text,
             i.subtotal_aud, i.gst_aud, i.total_aud,
             v.name as vendor_name, v.abn as vendor_abn
      from invoices i
      join vendors v on v.id = i.vendor_id
      order by i.invoice_number`
    const allLines = await sql<LineRow[]>`
      select invoice_id, item_code, description, qty, unit_price_aud, line_total_aud
      from invoice_lines`
    const linesByInvoice = new Map<string, LineRow[]>()
    for (const l of allLines) {
      const list = linesByInvoice.get(l.invoice_id) ?? []
      list.push(l)
      linesByInvoice.set(l.invoice_id, list)
    }

    const page = await browser.newPage()
    for (const inv of invoices) {
      const html = renderHtml(inv, linesByInvoice.get(inv.id) ?? [])
      await page.setContent(html, { waitUntil: 'load' })
      const pdf = await page.pdf({ format: 'A4', printBackground: true })
      const path = `${inv.invoice_number}.pdf`

      const { error } = await storage.upload(path, pdf, {
        contentType: 'application/pdf',
        upsert: true,
      })
      if (error) throw new Error(`upload ${path} failed: ${error.message}`)
      await sql`update invoices set pdf_path = ${path} where id = ${inv.id}`
    }
    console.log(`generated ${invoices.length} invoice PDFs into the '${BUCKET}' bucket`)
  } finally {
    await browser.close()
    await sql.end()
  }
}

await main()
