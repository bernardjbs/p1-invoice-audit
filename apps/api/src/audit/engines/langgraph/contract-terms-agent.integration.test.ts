import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import type { ExtractedInvoice } from '../../extraction'
import { PLANTED_VIOLATIONS, PROSE_ONLY_SECTION } from '../../../db/contract-docs'
import { runContractTermsCheck } from './contract-terms-agent'

/**
 * The contract-terms agent against the real corpus and a real model.
 * Plan: 2026-09-04-p1-phase-b-langgraph-engine, task T6.
 *
 * One case, and it is chosen deliberately: INV-0021 charges a weekend call-out
 * loading, which adds up, matches its purchase order, and sits on no rate card —
 * so all three deterministic checks pass it. The ONLY thing that catches it is
 * §6 of the vendor's contract, in prose. If this spec passes, the reading is
 * doing work nothing cheaper could do; every other planted breach would have
 * proved only that the model agrees with arithmetic.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const sql = postgres(DATABASE_URL, { max: 1 })

afterAll(async () => {
  await sql.end()
})

describe('runContractTermsCheck (live)', () => {
  it('flags the prose-only breach and cites the clause that forbids it', async () => {
    const planted = PLANTED_VIOLATIONS.find((v) => v.clauseSection === PROSE_ONLY_SECTION)!

    const [inv] = await sql<{ id: string; vendor_id: string; abn: string }[]>`
      select i.id, i.vendor_id, v.abn
      from invoices i join vendors v on v.id = i.vendor_id
      where i.invoice_number = ${planted.invoiceNumber}`
    expect(inv, `seeded ${planted.invoiceNumber}`).toBeDefined()

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
      from invoice_lines where invoice_id = ${inv!.id} order by item_code`

    const invoice: ExtractedInvoice = {
      invoiceNumber: planted.invoiceNumber,
      abn: inv!.abn,
      subtotalAud: 5850,
      gstAud: 585,
      totalAud: 6435,
      lines: lines.map((l) => ({
        itemCode: l.item_code,
        description: l.description,
        qty: Number(l.qty),
        unitPriceAud: Number(l.unit_price_aud),
        lineTotalAud: Number(l.line_total_aud),
      })),
    }

    const result = await runContractTermsCheck(invoice, inv!.vendor_id)

    // The verdict: it must not wave through a breach only it can see.
    expect(result.type).toBe('contract_terms')
    expect(result.verdict, `verdict was ${result.verdict}: ${result.evidence.summary}`).not.toBe(
      'pass',
    )
    // The citation: a real clause of THIS vendor's contract, from the retrieved
    // row rather than the model's prose.
    expect(result.evidence.sourceRef).toBe(planted.sourceRef)
  }, 60_000)
})
