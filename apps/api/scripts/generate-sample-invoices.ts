import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { renderHtml, type InvoiceRow, type LineRow } from './invoice-html'
import { SAMPLE_PREFIX } from '../src/invoices/sample-cleanup'

/**
 * The invoices a visitor can download, fill nothing in, and upload.
 *
 * WHY THIS EXISTS. The upload page asks for a PDF and a visitor has none, so the
 * only people who ever saw an audit run were the ones who happened to have an
 * Australian tax invoice to hand. These give them one.
 *
 * WHY IT IS A SEPARATE SET FROM `generate-e2e-fixture.ts`. The two e2e fixtures
 * are load-bearing bytes for three specs, and one of them is billed to the
 * deliberately unapproved supplier, whose vendor check the live engine wrongly
 * passes. Sharing the files would either put that known defect in front of a
 * visitor or make a demo change able to redden the paid suite. The renderer is
 * shared, which is the part that has to not drift; the invoices are not.
 *
 * WHY EVERY SAMPLE IS BILLED BY PILBARA PUMPS. It is approved, and it is one of
 * the four vendors the seed gives a contract, so the rate card has something to
 * compare against and the clause retrieval has something to retrieve. A vendor
 * with no clauses short-circuits the contract check to a pass without ever
 * calling retrieval, which demonstrates nothing.
 *
 * WHY THERE IS NO CLEAN SAMPLE. There cannot be one yet. The upload form carries
 * no purchase-order reference, so `po_match` flags on everything uploaded through
 * the UI, and the missing PO is visible on the page to the clause check as well.
 * An invoice advertised as clean would come back with findings and read as a
 * broken product. The page says this in words instead.
 *
 * ONE FAULT EACH, ON PURPOSE. An invoice carrying every fault proves almost
 * nothing: if all the checks fire together, a check that fires unconditionally is
 * indistinguishable from one that works.
 *
 * WHAT THE REAL ENGINE ACTUALLY RETURNED, measured 2026-09-29 against all three:
 *
 *   arithmetic-mismatch     math fail · price pass · po flag · contract fail
 *   overpriced-line         math pass · price FLAG · po flag · contract fail
 *   contract-clause-breach  math pass · price pass · po flag · contract fail (cites the call-out)
 *
 * Two things that wording has to respect. The rate check returns `flag`, not
 * `fail`, and the page shows the word it returns. And the contract check fires
 * on all three: on two of them it is objecting to the missing purchase order
 * rather than to the planted fault, which is the same upload-form gap `po_match`
 * reports. So the set isolates the planted fault among the checks a visitor
 * should read, but it does not produce a single finding, and the page must not
 * claim it does.
 *
 * Run it with:  bun run --filter '@starter/api' samples
 */

/** Pilbara's contracted rates, from the seed's rate card. Keep in step with it. */
const RATE_PUMP = 5000
const RATE_VALVE = 250
const RATE_LABOUR = 120

const VENDOR = { vendor_name: 'Pilbara Pumps Pty Ltd', vendor_abn: '51000000680' }

type Sample = {
  file: string
  /**
   * The check this invoice is built to trip, named exactly as the results page
   * names it. The upload page leads each row with it, so a visitor learns the
   * vocabulary before they upload rather than after.
   */
  check: string
  /** Shown on the upload page as the name of the download. */
  title: string
  /** One sentence: what a reader should watch for in the result. */
  proves: string
  invoice: InvoiceRow
  lines: LineRow[]
}

/**
 * The sums do not add up, and nothing else is wrong.
 *
 *   lines sum to the subtotal   5,000.00 + 500.00 = 5,500.00  correct
 *   subtotal + GST vs total     5,500.00 + 550.00 = 6,050.00, printed as 6,325.00  WRONG
 *
 * Both lines are billed at exactly the contracted rate, so the rate check passes
 * and the arithmetic failure stands alone. The extraction prompt tells the model
 * to transcribe what is printed even when it looks wrong, so the mismatch
 * survives being read off the page.
 */
const ARITHMETIC: Sample = {
  file: 'arithmetic-mismatch.pdf',
  check: 'Arithmetic',
  title: 'The sums do not add up',
  proves: 'The arithmetic check fails: the printed total is $275.00 more than subtotal plus GST.',
  invoice: {
    id: 'sample-arithmetic',
    invoice_number: `${SAMPLE_PREFIX}0001`,
    invoice_date: '2026-03-02',
    due_date: '2026-04-01',
    subtotal_aud: 5500,
    gst_aud: 550,
    total_aud: 6325, // Deliberately not 6050.
    ...VENDOR,
  },
  lines: [
    {
      invoice_id: 'sample-arithmetic',
      item_code: 'PUMP-100',
      description: 'Centrifugal slurry pump',
      qty: 1,
      unit_price_aud: RATE_PUMP,
      line_total_aud: RATE_PUMP,
    },
    {
      invoice_id: 'sample-arithmetic',
      item_code: 'VALVE-050',
      description: 'Ball valve DN50',
      qty: 2,
      unit_price_aud: RATE_VALVE,
      line_total_aud: RATE_VALVE * 2,
    },
  ],
}

/**
 * One line billed above its contracted rate, and nothing else wrong.
 *
 * The pump is contracted at $5,000.00 and billed at $5,750.00, 15% over. Every
 * sum on the page is exact, so the arithmetic check passes and the overcharge is
 * the only finding. The labour line is at its contracted rate, which is what
 * makes the pump line's variance attributable rather than ambient.
 */
const OVERPRICED: Sample = {
  file: 'overpriced-line.pdf',
  check: 'Price vs contract',
  title: 'A line billed above the contracted rate',
  proves:
    'The rate check flags: the pump is contracted at $5,000.00 and billed at $5,750.00, 15% over.',
  invoice: {
    id: 'sample-overpriced',
    invoice_number: `${SAMPLE_PREFIX}0002`,
    invoice_date: '2026-03-04',
    due_date: '2026-04-03',
    subtotal_aud: 6230,
    gst_aud: 623,
    total_aud: 6853,
    ...VENDOR,
  },
  lines: [
    {
      invoice_id: 'sample-overpriced',
      item_code: 'PUMP-100',
      description: 'Centrifugal slurry pump',
      qty: 1,
      unit_price_aud: 5750, // Contracted rate is RATE_PUMP.
      line_total_aud: 5750,
    },
    {
      invoice_id: 'sample-overpriced',
      item_code: 'LABOUR-HR',
      description: 'Site labour',
      qty: 4,
      unit_price_aud: RATE_LABOUR,
      line_total_aud: RATE_LABOUR * 4,
    },
  ],
}

/**
 * A charge no sum on the page can object to, which the contract forbids.
 *
 * Arithmetically perfect and the pump is at its contracted rate, so arithmetic
 * and the rate card both pass. `CALLOUT-WE` is on no rate card, so the rate check
 * has nothing to compare it against and skips it by design. The only thing that
 * finds this charge is reading the agreement: MSA-1000 section 6 forbids any
 * surcharge or call-out fee for out-of-hours work without prior written approval.
 *
 * This is the one sample that needs the language model and the clause retrieval,
 * so it is the one worth watching the cited clause on.
 */
const CLAUSE: Sample = {
  file: 'contract-clause-breach.pdf',
  check: 'Contract / vendor',
  title: 'A charge the contract forbids',
  proves:
    'The contract check fails and cites the clause: a weekend call-out fee, which the agreement forbids without prior written approval.',
  invoice: {
    id: 'sample-clause',
    invoice_number: `${SAMPLE_PREFIX}0003`,
    invoice_date: '2026-03-07',
    due_date: '2026-04-06',
    subtotal_aud: 5850,
    gst_aud: 585,
    total_aud: 6435,
    ...VENDOR,
  },
  lines: [
    {
      invoice_id: 'sample-clause',
      item_code: 'PUMP-100',
      description: 'Centrifugal slurry pump',
      qty: 1,
      unit_price_aud: RATE_PUMP,
      line_total_aud: RATE_PUMP,
    },
    {
      invoice_id: 'sample-clause',
      item_code: 'CALLOUT-WE',
      description: 'Weekend call-out loading, Saturday attendance outside standard hours',
      qty: 1,
      unit_price_aud: 850,
      line_total_aud: 850,
    },
  ],
}

const SAMPLES: Sample[] = [ARITHMETIC, OVERPRICED, CLAUSE]

const PDF_DIR = resolve(import.meta.dirname, '../../web/public/samples')
const MANIFEST = resolve(import.meta.dirname, '../../web/src/features/invoices/samples.json')

/**
 * The upload page reads the manifest this writes, so the amounts it tells a
 * visitor to type are the amounts printed on the PDF they downloaded. Typing
 * them by hand in the page instead would let the two drift, and the invoice
 * header would then contradict the checks — the exact fault this app exists to
 * catch, committed by the app itself.
 */
async function main(): Promise<void> {
  await mkdir(PDF_DIR, { recursive: true })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const sample of SAMPLES) {
      await page.setContent(renderHtml(sample.invoice, sample.lines), { waitUntil: 'load' })
      const pdf = await page.pdf({ format: 'A4', printBackground: true })
      await writeFile(resolve(PDF_DIR, sample.file), pdf)
      console.log(`wrote ${pdf.byteLength} bytes to ${sample.file}`)
    }
  } finally {
    await browser.close()
  }

  const manifest = SAMPLES.map((s) => ({
    file: s.file,
    check: s.check,
    title: s.title,
    proves: s.proves,
    invoiceNumber: s.invoice.invoice_number,
    vendorName: s.invoice.vendor_name,
    subtotalAud: s.invoice.subtotal_aud,
    gstAud: s.invoice.gst_aud,
    totalAud: s.invoice.total_aud,
  }))
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`wrote ${manifest.length} entries to samples.json`)
}

await main()
