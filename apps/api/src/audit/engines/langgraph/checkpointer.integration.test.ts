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
   * THE GUARD FOR THE PDF FIX. `AuditState` carried `pdf: Buffer` until T9, so
   * every step wrote the whole document into a checkpoint row: a 55KB fixture
   * became megabytes across a run, to store a file already sitting in Storage.
   * The fix was to carry the storage key instead, and this is what stops it being
   * quietly undone. Mutation-proved by restoring `pdf: Annotation<Buffer>` and
   * passing real bytes, which takes the largest row from ~1KB to ~75KB.
   */
  it('keeps saved state small, because the PDF is a key and not bytes', async () => {
    const invoiceId = crypto.randomUUID()

    await runAuditGraph(
      { invoiceId, vendorId: crypto.randomUUID(), pdfPath: 'INV-CKPT-1.pdf' },
      deps,
      await getCheckpointer(),
    )

    const [row] = await sql<{ largest: string }[]>`
      select coalesce(max(octet_length(checkpoint::text)), 0)::text as largest
      from ${sql(CHECKPOINT_SCHEMA)}.checkpoints where thread_id = ${invoiceId}`

    // A real invoice PDF is tens of kilobytes; the state without one is a few
    // hundred bytes of ids, numbers and four check results. 8KB sits far above
    // the former and far below the latter, so it catches a Buffer coming back
    // without failing on ordinary growth of the state.
    expect(Number(row!.largest)).toBeLessThan(8 * 1024)
  })
})
