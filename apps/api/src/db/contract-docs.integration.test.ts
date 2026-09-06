import { afterAll, describe, expect, it } from 'vitest'
import type { ExtractedInvoice } from '../audit/extraction'
import { runMathCheck, runPoMatchCheck, runPriceCheck } from '../audit/engines/langgraph/checks'
import { loadPo, loadRates } from '../audit/engines/langgraph/loaders'
import { retrieveRelevantContext } from '../audit/retrieval'
import {
  CONTRACT_VENDORS,
  PLANTED_VIOLATIONS,
  PROSE_ONLY_SECTION,
  chunksFor,
} from './contract-docs'
import { sql } from './client'

/**
 * The embedded corpus, as it actually lands in the database.
 * Plan: 2026-09-04-p1-phase-b-langgraph-engine, task T3.
 *
 * Integration tier: requires a seeded local database
 * (`doppler run -c dev -- bun run seed`). The retrieval case makes ONE live
 * embedding call — everything else reads rows.
 */

afterAll(async () => {
  await sql.end()
})

type ChunkRow = {
  id: string
  contract_id: string
  vendor_id: string
  source_ref: string
  content: string
}

/**
 * The invoice fields the deterministic checks need, read straight from the rows
 * rather than from the PDF. The checks are what is under test here, not the
 * extraction — pulling this through a live model would make a data-integrity
 * spec depend on a model's reading, which is the wrong thing to gate on.
 */
async function loadExtractedForTest(invoiceId: string): Promise<ExtractedInvoice> {
  const [inv] = await sql<
    {
      invoice_number: string
      abn: string
      subtotal_aud: string
      gst_aud: string
      total_aud: string
    }[]
  >`
    select i.invoice_number, v.abn, i.subtotal_aud::text, i.gst_aud::text, i.total_aud::text
    from invoices i join vendors v on v.id = i.vendor_id
    where i.id = ${invoiceId}`
  const lines = await sql<
    {
      item_code: string
      description: string
      qty: string
      unit_price_aud: string
      line_total_aud: string
    }[]
  >`
    select item_code, description, qty::text, unit_price_aud::text, line_total_aud::text
    from invoice_lines where invoice_id = ${invoiceId} order by item_code`

  return {
    invoiceNumber: inv!.invoice_number,
    abn: inv!.abn,
    subtotalAud: Number(inv!.subtotal_aud),
    gstAud: Number(inv!.gst_aud),
    totalAud: Number(inv!.total_aud),
    lines: lines.map((l) => ({
      itemCode: l.item_code,
      description: l.description,
      qty: Number(l.qty),
      unitPriceAud: Number(l.unit_price_aud),
      lineTotalAud: Number(l.line_total_aud),
    })),
  }
}

describe('the embedded corpus', () => {
  it('holds at least five clauses per contracted vendor', async () => {
    const [row] = await sql<{ count: string }[]>`select count(*)::text from contract_chunks`
    expect(Number(row!.count)).toBeGreaterThanOrEqual(CONTRACT_VENDORS.length * 5)
  })

  it('gives every row a vendor and a citation', async () => {
    // The vendor is what scopes retrieval, and the citation is what gets shown
    // to a human — a row missing either is unusable rather than merely untidy.
    const rows = await sql<ChunkRow[]>`
      select id, contract_id, vendor_id, source_ref, content from contract_chunks`

    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.vendor_id).toBeTruthy()
      expect(row.source_ref.trim()).not.toBe('')
      expect(row.content.trim()).not.toBe('')
    }
  })

  it('stores each vendor’s clauses against that vendor’s own contract', async () => {
    const rows = await sql<{ msa_ref: string; source_ref: string }[]>`
      select c.msa_ref, ch.source_ref
      from contract_chunks ch join contracts c on c.id = ch.contract_id`

    for (const row of rows) {
      expect(row.source_ref.startsWith(row.msa_ref)).toBe(true)
    }
  })

  it('stores every clause the generator produced, none dropped', async () => {
    for (const vendor of CONTRACT_VENDORS) {
      const expected = chunksFor(vendor)
        .map((c) => c.sourceRef)
        .sort()
      const rows = await sql<{ source_ref: string }[]>`
        select ch.source_ref
        from contract_chunks ch join contracts c on c.id = ch.contract_id
        where c.msa_ref = ${vendor.msaRef}
        order by ch.source_ref`
      expect(rows.map((r) => r.source_ref)).toEqual(expected)
    }
  })

  it('plants violations that are actually true of the seeded invoices', async () => {
    // The answer key is what every later evaluation is scored against. If a
    // planted violation drifted from the data, the evaluation would mark a
    // correct verdict wrong and nothing would say so.
    for (const violation of PLANTED_VIOLATIONS) {
      const [inv] = await sql<
        {
          subtotal_aud: string
          total_aud: string
          po_total: string
          lines_sum: string
          worst_ratio: string | null
        }[]
      >`
        select i.subtotal_aud::text, i.total_aud::text, po.total_aud::text as po_total,
               (select coalesce(sum(l.line_total_aud), 0) from invoice_lines l where l.invoice_id = i.id)::text
                 as lines_sum,
               (select max(l.unit_price_aud / r.rate_aud)
                  from invoice_lines l
                  join contract_rates r
                    on r.item_code = l.item_code and r.contract_id = i.contract_id
                 where l.invoice_id = i.id)::text as worst_ratio
        from invoices i
        join purchase_orders po on po.id = i.po_id
        where i.invoice_number = ${violation.invoiceNumber}`
      expect(inv, `no seeded invoice ${violation.invoiceNumber}`).toBeDefined()

      const vendor = CONTRACT_VENDORS.find((v) => v.msaRef === violation.msaRef)!
      switch (violation.clauseSection) {
        case 3: // GST/arithmetic: subtotal must equal the sum of the lines.
          expect(Number(inv!.subtotal_aud)).not.toBeCloseTo(Number(inv!.lines_sum), 2)
          break
        case 4: // PO required: invoiced total must not exceed the PO total.
          expect(Number(inv!.total_aud)).not.toBeCloseTo(Number(inv!.po_total), 2)
          break
        case 5: // Rate variation cap.
          expect(Number(inv!.worst_ratio)).toBeGreaterThan(1 + vendor.rateVariationCapPct / 100)
          break
        case PROSE_ONLY_SECTION: {
          // No arithmetic can express "a call-out fee was charged without written
          // approval". The machine-checkable shadow of it is a charge sitting on
          // no rate card while everything countable about the invoice is clean.
          const [offCatalogue] = await sql<{ n: string }[]>`
            select count(*)::text as n
            from invoice_lines l
            join invoices i2 on i2.id = l.invoice_id
            left join contract_rates r
              on r.item_code = l.item_code and r.contract_id = i2.contract_id
            where i2.invoice_number = ${violation.invoiceNumber} and r.id is null`
          expect(Number(offCatalogue!.n)).toBeGreaterThan(0)
          expect(Number(inv!.subtotal_aud)).toBeCloseTo(Number(inv!.lines_sum), 2)
          expect(Number(inv!.total_aud)).toBeCloseTo(Number(inv!.po_total), 2)
          break
        }
        default:
          throw new Error(`no check written for clause §${violation.clauseSection}`)
      }
    }
  })

  it('plants one breach that ONLY reading the contract can catch', async () => {
    // Without this, every planted breach is also caught by arithmetic, and the
    // contract-terms agent's live spec proves only that an expensive model agrees
    // with a calculator. A prose-only obligation — no call-out fees without prior
    // written approval — is the case that separates reading from counting, and it
    // is the one the whole RAG capability exists for.
    const proseOnly = PLANTED_VIOLATIONS.filter((v) => v.clauseSection === PROSE_ONLY_SECTION)
    expect(proseOnly, 'a violation planted against the prose-only clause').toHaveLength(1)
    const target = proseOnly[0]!

    const [row] = await sql<{ id: string; vendor_id: string }[]>`
      select id, vendor_id from invoices where invoice_number = ${target.invoiceNumber}`
    expect(row, `no seeded invoice ${target.invoiceNumber}`).toBeDefined()

    const [extracted, rates, po] = await Promise.all([
      loadExtractedForTest(row!.id),
      loadRates(row!.vendor_id),
      loadPo(row!.id),
    ])

    // The point of the fixture: all three deterministic checks wave it through.
    expect(runMathCheck(extracted).verdict, 'maths must be clean').toBe('pass')
    expect(runPoMatchCheck(extracted, po).verdict, 'PO must match').toBe('pass')
    expect(runPriceCheck(extracted, rates).verdict, 'no rate-card breach').toBe('pass')

    // …and the charge it turns on is genuinely off the rate card, which is why
    // the price check cannot see it.
    const uncovered = extracted.lines.filter(
      (line) => !rates.some((rate) => rate.itemCode === line.itemCode),
    )
    expect(uncovered.length, 'a charge no rate card covers').toBeGreaterThan(0)
  })

  it('retrieves a planted clause for its own vendor, and nobody else’s', async () => {
    // End-to-end over the real embeddings: the corpus, the seam and the vendor
    // scope together. One live embedding call.
    const violation = PLANTED_VIOLATIONS[0]!
    const [contract] = await sql<{ vendor_id: string }[]>`
      select vendor_id from contracts where msa_ref = ${violation.msaRef}`

    const results = await retrieveRelevantContext(
      'may the supplier invoice above the agreed rate card?',
      contract!.vendor_id,
    )

    expect(results.length).toBeGreaterThan(0)
    expect(results.every((c) => c.vendorId === contract!.vendor_id)).toBe(true)
    expect(results.map((c) => c.sourceRef)).toContain(violation.sourceRef)
  })
})
