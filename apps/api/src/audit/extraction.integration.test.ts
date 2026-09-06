import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { downloadInvoicePdf } from '../lib/storage'
import { ExtractedInvoiceSchema, extractInvoiceFields } from './extraction'

/**
 * Live extraction over one real seeded PDF. Plan:
 * 2026-09-04-p1-phase-b-langgraph-engine, task T4.
 *
 * Needs the local Supabase (Postgres + Storage) seeded, and real credentials, so
 * it runs under `doppler run -c dev -- …` in the integration tier only.
 *
 * It asserts the SHAPE, not the accuracy: that a genuine PDF goes to a genuine
 * model and comes back as data this app will accept. How OFTEN the model is right
 * is a different question, answered over all twenty invoices by
 * `evals/extraction/run.ts` — a per-invoice equality assertion here would be a
 * one-sample accuracy claim dressed up as a test, and would go red for a model
 * that is still comfortably above threshold.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const sql = postgres(DATABASE_URL, { max: 1 })

afterAll(async () => {
  await sql.end()
})

describe('extractInvoiceFields (live)', () => {
  it('reads a seeded invoice PDF into schema-valid fields', async () => {
    const [row] = await sql<{ invoice_number: string; pdf_path: string }[]>`
      select invoice_number, pdf_path from invoices
      where pdf_path is not null order by invoice_number limit 1`
    expect(row, 'a seeded invoice with a pdf_path').toBeDefined()

    const pdf = await downloadInvoicePdf(row!.pdf_path)
    const extracted = await extractInvoiceFields(pdf)

    // Schema-valid by construction (extractInvoiceFields throws otherwise), but
    // asserted explicitly so the test states its own claim.
    expect(ExtractedInvoiceSchema.safeParse(extracted).success).toBe(true)
    // The one field cheap enough to pin: it is printed verbatim on the page, so
    // a mismatch means the model read the wrong document, not that it read badly.
    expect(extracted.invoiceNumber).toBe(row!.invoice_number)
    expect(extracted.lines.length).toBeGreaterThan(0)
  }, 60_000)
})
