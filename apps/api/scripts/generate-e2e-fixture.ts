import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { renderHtml, type InvoiceRow, type LineRow } from './invoice-html'

/**
 * Regenerate `e2e/fixtures/sample-invoice.pdf`, the one document the e2e suite
 * uploads.
 *
 * NOT part of `bun run seed` and not run by the suite: the fixture is committed
 * bytes so the specs never depend on a browser, a database or a clock. This
 * script exists so the bytes can be REPRODUCED and, more importantly, so the
 * numbers on the page are stated once, in source, where a reviewer can see what
 * the invoice is meant to prove.
 *
 * Run it with:  bun run --filter '@starter/api' e2e:fixture
 *
 * WHY THE ARITHMETIC IS WRONG. Under the LangGraph engine the audit's verdicts
 * come from what the model reads off THIS page, not from the numbers typed into
 * the upload form. `review-flow.spec.ts` needs an invoice that pauses for human
 * review, and the honest way to get one is an invoice that genuinely does not
 * add up. Exactly one defect is planted, so a failure has one explanation:
 *
 *   lines sum to the subtotal   4,000.00 + 440.00 = 4,440.00  ✓
 *   subtotal + GST vs total     4,440.00 +  444.00 = 4,884.00, printed as 5,328.00  ✗
 *
 * The extraction prompt tells the model to transcribe what is printed even when
 * the arithmetic looks wrong, so the mismatch survives extraction and the math
 * check fails on it. Everything else on the page is ordinary.
 */

const INVOICE: InvoiceRow = {
  id: 'e2e-fixture',
  invoice_number: 'INV-E2E-0001',
  invoice_date: '2026-03-02',
  due_date: '2026-04-01',
  subtotal_aud: 4440,
  gst_aud: 444,
  // Deliberately not 4884. See the note above.
  total_aud: 5328,
  vendor_name: 'Dodgy Diggers Supplies Pty Ltd',
  vendor_abn: '52 004 762 001',
}

const LINES: LineRow[] = [
  {
    invoice_id: 'e2e-fixture',
    item_code: 'PUMP-100',
    description: 'Centrifugal slurry pump, 100mm',
    qty: 1,
    unit_price_aud: 4000,
    line_total_aud: 4000,
  },
  {
    invoice_id: 'e2e-fixture',
    item_code: 'VALVE-050',
    description: 'Gate valve, 50mm, stainless',
    qty: 2,
    unit_price_aud: 220,
    line_total_aud: 440,
  },
]

const OUT = resolve(import.meta.dirname, '../../../e2e/fixtures/sample-invoice.pdf')

async function main(): Promise<void> {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(renderHtml(INVOICE, LINES), { waitUntil: 'load' })
    const pdf = await page.pdf({ format: 'A4', printBackground: true })
    await writeFile(OUT, pdf)
    console.log(`wrote ${pdf.byteLength} bytes to ${OUT}`)
  } finally {
    await browser.close()
  }
}

await main()
