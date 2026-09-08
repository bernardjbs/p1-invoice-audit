import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuditGraphDeps } from './audit/engines/langgraph/graph'
import type { ExtractedInvoice } from './audit/extraction'
import { enqueueAudit } from './queue/audit-queue'
import { runWorkerOnce } from './worker'

/**
 * The models are faked and the graph is real. What is under test is whether a
 * run is traced and its URL persisted, not what Claude says about an invoice —
 * a vision call and a judge per run would make this slow and costly for nothing.
 * The graph itself is traced either way, which is the whole point.
 *
 * Needs the local Supabase stack and a LangSmith key (Doppler `dev`).
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const sql = postgres(DATABASE_URL, { max: 1 })

const extracted: ExtractedInvoice = {
  invoiceNumber: 'INV-TRACE-1',
  abn: '51000000680',
  subtotalAud: 1000,
  gstAud: 100,
  totalAud: 1100,
  lines: [
    { itemCode: 'PUMP-100', description: 'Pump', qty: 1, unitPriceAud: 1000, lineTotalAud: 1000 },
  ],
}

const graphDeps: Partial<AuditGraphDeps> = {
  extract: async () => extracted,
  loadPo: async () => ({ poNumber: 'PO-TRACE-1', totalAud: 1100 }),
  loadRates: async () => [{ itemCode: 'PUMP-100', rateAud: 1000 }],
  judgeContractTerms: async () => ({
    type: 'contract_terms',
    verdict: 'pass',
    evidence: { summary: 'No clause forbids these charges.', sourceRef: 'MSA-1 §4' },
  }),
}

/** A real invoice row against an existing seeded vendor, so the foreign keys hold. */
async function seedInvoice(): Promise<string> {
  const [vendor] = await sql<{ id: string }[]>`select id from vendors order by name limit 1`
  const [row] = await sql<{ id: string }[]>`
    insert into invoices (vendor_id, invoice_number, invoice_date, due_date,
                          subtotal_aud, gst_aud, total_aud, status, pdf_path)
    values (${vendor!.id}, ${`INV-TRACE-${crypto.randomUUID().slice(0, 8)}`},
            current_date, current_date + 30, 1000, 100, 1100, 'received', 'INV-0001.pdf')
    returning id`
  return row!.id
}

let invoiceId: string

beforeAll(async () => {
  /**
   * Tracing is off unless asked for (`config/env` defaults `LANGSMITH_TRACING`
   * to false), so it is switched on here rather than in Doppler: a variable that
   * starts sending traces is not something every checkout should inherit.
   *
   * Assigning it this late is safe because nothing in this file's import graph
   * reads `config/env` at module scope — the engine reaches it through a dynamic
   * import inside `startAuditTrace()`, which does not run until the audit does.
   */
  process.env.LANGSMITH_TRACING = 'true'
  invoiceId = await seedInvoice()
  await enqueueAudit(invoiceId)
})

/**
 * Remove the invoice this file created. Not tidiness: a sibling spec asserts
 * EVERY invoice starts in `received`, and a row left behind here fails it, which
 * reads as a broken seed rather than as this file's residue. The cascade takes
 * the run, its checks and its trace URL with it.
 */
afterAll(async () => {
  await sql`delete from invoices where id = ${invoiceId}`
  await sql.end()
})

describe('a traced audit', () => {
  it('stores the run’s LangSmith trace URL on the audit run', async () => {
    await runWorkerOnce({ engine: 'langgraph', graphDeps })

    const [run] = await sql<{ trace_url: string | null }[]>`
      select trace_url from audit_runs where invoice_id = ${invoiceId}
      order by started_at desc limit 1`
    expect(run, 'the worker persisted no audit run').toBeDefined()
    expect(run!.trace_url).not.toBeNull()
    // The APAC host, specifically. A US or EU URL means the endpoint was
    // defaulted rather than read from the environment, and an APAC key gets a
    // 403 there — which reads as a bad key, not as a wrong region.
    expect(run!.trace_url).toContain('apac.smith.langchain.com')
    // Addressed at a run, not just at the project.
    expect(run!.trace_url).toMatch(/\/r\/[0-9a-f-]{36}/)
  }, 120_000)
})
