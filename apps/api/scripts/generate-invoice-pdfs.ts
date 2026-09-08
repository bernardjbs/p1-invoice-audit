import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
import postgres from 'postgres'
import { renderHtml, type InvoiceRow, type LineRow } from './invoice-html'

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
