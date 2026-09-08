import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { renderHtml, type InvoiceRow, type LineRow } from './invoice-html'

/**
 * Regenerate the PDFs the e2e suite uploads.
 *
 * NOT part of `bun run seed` and not run by the suite: the fixtures are committed
 * bytes so the specs never depend on a browser, a database or a clock. This
 * script exists so the bytes can be REPRODUCED and, more importantly, so the
 * numbers on each page are stated once, in source, where a reviewer can see what
 * the invoice is meant to prove.
 *
 * Run it with:  bun run --filter '@starter/api' e2e:fixture
 *
 * Two documents, because they prove different things. Under the LangGraph engine
 * every verdict comes from what the model reads off the page, not from the
 * numbers typed into the upload form, so each fixture has to CARRY the defect it
 * is meant to trigger.
 */

type Fixture = {
  file: string
  invoice: InvoiceRow
  lines: LineRow[]
}

/**
 * The arithmetic fixture, uploaded by `audit-flow` and `review-flow`.
 *
 * Exactly one defect is planted, so a failure has one explanation:
 *
 *   lines sum to the subtotal   4,000.00 + 440.00 = 4,440.00  ✓
 *   subtotal + GST vs total     4,440.00 +  444.00 = 4,884.00, printed as 5,328.00  ✗
 *
 * The extraction prompt tells the model to transcribe what is printed even when
 * the arithmetic looks wrong, so the mismatch survives extraction and the math
 * check fails on it. Everything else on the page is ordinary.
 */
const ARITHMETIC_BREACH: Fixture = {
  file: 'sample-invoice.pdf',
  invoice: {
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
  },
  lines: [
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
  ],
}

/**
 * The CLAUSE fixture, uploaded by `contract-citation.spec.ts` to prove golden
 * criterion 3: the contract-terms check retrieves from the MSA corpus through
 * pgvector and cites what it retrieved.
 *
 * WHY THIS INVOICE IS ARITHMETICALLY PERFECT. Lines sum to the subtotal, GST is
 * exactly 10%, the total adds up, and the pump is billed at Pilbara's contracted
 * rate of $5,000.00 to the cent, so `math` and `price_vs_contract` both pass it.
 *
 * `po_match` still FLAGS, and no fixture can prevent that: the upload form has no
 * PO field, so nothing uploaded through the UI carries one. So this is not an
 * invoice whose only defect is invisible to arithmetic; it is an invoice whose
 * only defect in the CONTRACT dimension is.
 *
 * WHY THE CALL-OUT LINE. Pilbara's MSA-1000 §6 ("Hours of Work and Surcharges")
 * forbids any surcharge, loading, penalty or call-out fee for out-of-hours work
 * without prior written approval. `CALLOUT-WE` is on no rate card, so the price
 * check has nothing to compare it against and skips it: no sum on this page finds
 * the call-out charge, only reading §6 does.
 *
 * The missing PO is visible to the model too, because `renderInvoice` omits the
 * PO line when there is none, so §2 (payment terms) and §4 (purchase orders
 * required) are breachable on that ground alone. Every measured run has cited §6,
 * but the spec deliberately does not pin the clause, so a green run is not by
 * itself proof that §6 was the clause that mattered.
 *
 * WHY PILBARA. It is one of the four vendors the seed gives a contract (8 chunks;
 * the other two have none, and a vendor with no clauses makes the check
 * short-circuit to `pass` without ever calling retrieval). The breach mirrors the
 * corpus's own planted prose-only breach rather than inventing one the generated
 * MSAs cannot express.
 *
 * The vendor NAME and ABN must keep matching the seed, because the spec picks
 * this vendor by name in the upload form.
 */
const CLAUSE_BREACH: Fixture = {
  file: 'clause-breach-invoice.pdf',
  invoice: {
    id: 'e2e-clause-fixture',
    invoice_number: 'INV-E2E-0002',
    invoice_date: '2026-03-07',
    due_date: '2026-04-06',
    subtotal_aud: 5850,
    gst_aud: 585,
    total_aud: 6435,
    vendor_name: 'Pilbara Pumps Pty Ltd',
    vendor_abn: '51000000680',
  },
  lines: [
    {
      invoice_id: 'e2e-clause-fixture',
      item_code: 'PUMP-100',
      description: 'Centrifugal slurry pump',
      qty: 1,
      // Exactly the contracted rate, so the price check passes.
      unit_price_aud: 5000,
      line_total_aud: 5000,
    },
    {
      invoice_id: 'e2e-clause-fixture',
      item_code: 'CALLOUT-WE',
      description: 'Weekend call-out loading, Saturday attendance outside standard hours',
      qty: 1,
      unit_price_aud: 850,
      line_total_aud: 850,
    },
  ],
}

const FIXTURES: Fixture[] = [ARITHMETIC_BREACH, CLAUSE_BREACH]

const OUT_DIR = resolve(import.meta.dirname, '../../../e2e/fixtures')

async function main(): Promise<void> {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const fixture of FIXTURES) {
      await page.setContent(renderHtml(fixture.invoice, fixture.lines), { waitUntil: 'load' })
      const pdf = await page.pdf({ format: 'A4', printBackground: true })
      const out = resolve(OUT_DIR, fixture.file)
      await writeFile(out, pdf)
      console.log(`wrote ${pdf.byteLength} bytes to ${out}`)
    }
  } finally {
    await browser.close()
  }
}

await main()
