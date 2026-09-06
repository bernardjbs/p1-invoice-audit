import { afterAll, describe, expect, it } from 'vitest'
import { retrieveRelevantContext } from '../audit/retrieval'
import { CONTRACT_VENDORS, PLANTED_VIOLATIONS, chunksFor } from './contract-docs'
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
        default:
          throw new Error(`no check written for clause §${violation.clauseSection}`)
      }
    }
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
