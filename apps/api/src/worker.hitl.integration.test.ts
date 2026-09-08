import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { langGraphDefaultDeps, resumeLangGraphEngine } from './audit/engines/langgraph'
import { CHECKPOINT_SCHEMA, getCheckpointer } from './audit/engines/langgraph/checkpointer'
import { buildAuditGraph } from './audit/engines/langgraph/graph'
import { submitReview } from './review/service'
import type { AuditGraphDeps } from './audit/engines/langgraph/graph'
import type { ExtractedInvoice } from './audit/extraction'
import { enqueueAudit } from './queue/audit-queue'
import { runWorkerOnce } from './worker'

/**
 * What the worker leaves behind when the engine suspends a run (plan:
 * 2026-09-04-p1-phase-b-langgraph-engine, task T9, step 4).
 *
 * Drives the REAL worker against a real database and a real queue, with the
 * models faked through the seam's own options bag. Faking them is the point:
 * this asserts the end state in Postgres, and a vision call per run would make
 * it slow, costly and non-deterministic for no gain.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const sql = postgres(DATABASE_URL, { max: 1 })

afterAll(async () => {
  await sql.end()
})

const extracted: ExtractedInvoice = {
  invoiceNumber: 'INV-WORKER-HITL',
  abn: '51000000680',
  subtotalAud: 1000,
  gstAud: 100,
  totalAud: 1100,
  lines: [
    { itemCode: 'PUMP-100', description: 'Pump', qty: 1, unitPriceAud: 1000, lineTotalAud: 1000 },
  ],
}

function graphDeps(overrides: Partial<AuditGraphDeps> = {}): Partial<AuditGraphDeps> {
  return {
    extract: async () => extracted,
    loadPo: async () => ({ poNumber: 'PO-WORKER-1', totalAud: 1100 }),
    loadRates: async () => [{ itemCode: 'PUMP-100', rateAud: 1000 }],
    judgeContractTerms: async () => ({
      type: 'contract_terms',
      verdict: 'pass',
      evidence: { summary: 'No clause forbids these charges.', sourceRef: 'MSA-1 §4' },
    }),
    ...overrides,
  }
}

/** A real invoice row for an existing seeded vendor, so foreign keys hold. */
async function seedInvoice(): Promise<string> {
  const [vendor] = await sql<{ id: string }[]>`select id from vendors order by name limit 1`
  const [row] = await sql<{ id: string }[]>`
    insert into invoices (vendor_id, invoice_number, invoice_date, due_date,
                          subtotal_aud, gst_aud, total_aud, status, pdf_path)
    values (${vendor!.id}, ${`INV-WORKER-${crypto.randomUUID().slice(0, 8)}`},
            current_date, current_date + 30, 1000, 100, 1100, 'received', 'INV-0001.pdf')
    returning id`
  return row!.id
}

/** Is a run still suspended under this invoice, waiting for a person? */
async function isWaiting(id: string): Promise<boolean> {
  const graph = buildAuditGraph(
    { ...langGraphDefaultDeps(), ...graphDeps() } as AuditGraphDeps,
    await getCheckpointer(),
  )
  const snapshot = await graph.getState({ configurable: { thread_id: id } })
  return snapshot.tasks.some((task) => task.interrupts.length > 0)
}

let invoiceId: string
const created: string[] = []

beforeEach(async () => {
  invoiceId = await seedInvoice()
  created.push(invoiceId)
  await enqueueAudit(invoiceId)
})

/**
 * Remove the invoices these cases created. Not tidiness: a sibling spec asserts
 * that EVERY invoice starts in `received`, and rows left behind here fail it,
 * which reads as a broken seed rather than as this file's residue. Cascades take
 * the runs, checks and decisions with them.
 */
afterAll(async () => {
  if (created.length > 0) await sql`delete from invoices where id in ${sql(created)}`
})

describe('the worker, when the engine suspends a run', () => {
  it('records the checks, parks the invoice for review, and leaves resumable state', async () => {
    // A genuinely failing check, NOT an injected pause rule. Overriding the rule
    // for the engine only would fabricate a state production cannot reach: the
    // engine would suspend while the worker, using the shared rule, called the
    // invoice passed. That is the drift `audit/pause-rule.ts` exists to prevent,
    // and an earlier version of this test manufactured it and failed for that
    // reason. The failing verdict makes BOTH sides agree, honestly.
    await runWorkerOnce({
      engine: 'langgraph',
      graphDeps: graphDeps({
        judgeContractTerms: async () => ({
          type: 'contract_terms',
          verdict: 'fail',
          evidence: { summary: 'Weekend loading is not permitted.', sourceRef: 'MSA-1 §6' },
        }),
      }),
    })

    const [invoice] = await sql<{ status: string }[]>`
      select status from invoices where id = ${invoiceId}`
    expect(invoice!.status).toBe('paused_review')

    // The four checks are persisted even though the run never finished, so the
    // review screen can show WHY it stopped. This is what makes the pause useful
    // to a person rather than just correct to the engine.
    const [checks] = await sql<{ n: string }[]>`
      select count(c.*)::text as n from audit_runs r
      join check_results c on c.audit_run_id = r.id where r.invoice_id = ${invoiceId}`
    expect(Number(checks!.n)).toBe(4)

    // And the run itself is still waiting, under the invoice id, for a different
    // process to pick up. Without this row the pause is only a status flag.
    const [ckpt] = await sql<{ n: string }[]>`
      select count(*)::text as n from ${sql(CHECKPOINT_SCHEMA)}.checkpoints
      where thread_id = ${invoiceId}`
    expect(Number(ckpt!.n)).toBeGreaterThan(0)
  })

  it('resumes the suspended run when the decision comes back on the queue', async () => {
    const failing = graphDeps({
      judgeContractTerms: async () => ({
        type: 'contract_terms',
        verdict: 'fail',
        evidence: { summary: 'Weekend loading is not permitted.', sourceRef: 'MSA-1 §6' },
      }),
    })

    await runWorkerOnce({ engine: 'langgraph', graphDeps: failing })
    expect(await isWaiting(invoiceId)).toBe(true)

    // What the approve endpoint does: record the decision, then queue the
    // continuation. Called directly so this stays a worker test, not an HTTP one.
    await submitReview(invoiceId, 'approved', 'looks fine on manual review')
    await runWorkerOnce({ engine: 'langgraph', graphDeps: failing })

    // The run is finished: nothing is waiting on that thread any more.
    expect(await isWaiting(invoiceId)).toBe(false)

    const [invoice] = await sql<{ status: string }[]>`
      select status from invoices where id = ${invoiceId}`
    expect(invoice!.status).toBe('approved')

    const [decisions] = await sql<{ n: string }[]>`
      select count(*)::text as n from review_decisions where invoice_id = ${invoiceId}`
    expect(Number(decisions!.n)).toBe(1)

    // Still ONE audit run. Resuming completes the existing run; it does not start
    // a second one, and the checks were persisted when it paused.
    const [runs] = await sql<{ n: string }[]>`
      select count(*)::text as n from audit_runs where invoice_id = ${invoiceId}`
    expect(Number(runs!.n)).toBe(1)
  })

  it('treats a repeated resume as a no-op rather than an error', async () => {
    await runWorkerOnce({ engine: 'langgraph', graphDeps: graphDeps() })

    // Nothing is suspended: this invoice passed cleanly. A redelivered or
    // duplicated resume must be harmless, because the queue delivers at least
    // once and an approval can be clicked twice.
    await expect(resumeLangGraphEngine(invoiceId, 'approved', graphDeps())).resolves.toBe(false)
  })

  it('passes a clean invoice through without parking it', async () => {
    await runWorkerOnce({ engine: 'langgraph', graphDeps: graphDeps() })

    const [invoice] = await sql<{ status: string }[]>`
      select status from invoices where id = ${invoiceId}`
    expect(invoice!.status).toBe('passed')
  })
})
