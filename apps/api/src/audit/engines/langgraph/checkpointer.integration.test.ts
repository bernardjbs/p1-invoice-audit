import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import type { ExtractedInvoice } from '../../extraction'
import { CHECKPOINT_SCHEMA, getCheckpointer } from './checkpointer'
import { runAuditGraph, type AuditGraphDeps } from './graph'

/**
 * The checkpointer, proved against a real Postgres (plan:
 * 2026-09-04-p1-phase-b-langgraph-engine, task T9).
 *
 * These run the GENUINE graph with FAKE models: the point under test is what
 * reaches the database, not what Claude says, so every dependency is injected
 * and no credentials are needed. Requires the local Supabase stack.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const sql = postgres(DATABASE_URL, { max: 1 })

const extracted: ExtractedInvoice = {
  invoiceNumber: 'INV-CKPT-1',
  abn: '51000000680',
  subtotalAud: 1000,
  gstAud: 100,
  totalAud: 1100,
  lines: [
    { itemCode: 'PUMP-100', description: 'Pump', qty: 1, unitPriceAud: 1000, lineTotalAud: 1000 },
  ],
}

/** Every model and query faked; only the graph and the saver are real. */
const deps: AuditGraphDeps = {
  extract: async () => extracted,
  loadPo: async () => null,
  loadRates: async () => [],
  judgeContractTerms: async () => ({
    type: 'contract_terms',
    verdict: 'pass',
    evidence: { summary: 'No clauses on file.' },
  }),
  // These cases measure what a COMPLETED run writes. Pausing is the HITL specs'
  // subject; suspending here would stop the run before its last checkpoint.
  needsHumanReview: () => false,
}

beforeAll(async () => {
  await getCheckpointer()
})

afterAll(async () => {
  await sql.end()
})

describe('the audit graph checkpointer', () => {
  it('files its state under the invoice id, so another process can find it', async () => {
    const invoiceId = crypto.randomUUID()

    await runAuditGraph(
      { invoiceId, vendorId: crypto.randomUUID(), pdfPath: 'INV-CKPT-1.pdf' },
      deps,
      await getCheckpointer(),
    )

    const rows = await sql<{ n: string }[]>`
      select count(*)::text as n from ${sql(CHECKPOINT_SCHEMA)}.checkpoints
      where thread_id = ${invoiceId}`
    expect(Number(rows[0]!.n)).toBeGreaterThan(0)
  })

  /**
   * THE GUARD FOR THE PDF FIX. `AuditState` carried `pdf: Buffer` until checkpointing landed, so
   * every step wrote the whole document into a checkpoint row: a 55KB fixture
   * became megabytes across a run, to store a file already sitting in Storage.
   * The fix was to carry the storage key instead, and this is what stops it being
   * quietly undone.
   *
   * MEASURE `checkpoint_blobs`, NOT `checkpoints`. The first version of this test
   * summed `octet_length(checkpoint::text)` and could never have failed: that
   * column holds metadata and channel VERSIONS, while every actual value is a row
   * in `checkpoint_blobs`. Restoring `pdf: Annotation<Buffer>` and passing 60KB of
   * bytes left it green, which is how the vacuous assertion was found. Under that
   * same mutation this version failed with 181,083 bytes against a 16,384 budget:
   * 60,000 for the `pdf` channel plus 120,162 for `__start__`, where the input is
   * JSON-encoded and a byte array costs roughly double, plus the ordinary state.
   */
  it('keeps saved state small, because the PDF is a key and not bytes', async () => {
    const invoiceId = crypto.randomUUID()

    await runAuditGraph(
      { invoiceId, vendorId: crypto.randomUUID(), pdfPath: 'INV-CKPT-1.pdf' },
      deps,
      await getCheckpointer(),
    )

    const [row] = await sql<{ total: string }[]>`
      select coalesce(sum(octet_length(blob)), 0)::text as total
      from ${sql(CHECKPOINT_SCHEMA)}.checkpoint_blobs where thread_id = ${invoiceId}`

    // Every value this run wrote, added up. Measured clean: 2,553 bytes of ids,
    // numbers and four check results. A single real invoice PDF is tens of
    // kilobytes and lands twice over (once as its own channel, once inside the
    // JSON-encoded input), so 16KB sits well above honest growth and well below
    // any document coming back.
    expect(Number(row!.total)).toBeLessThan(16 * 1024)
  })
})
