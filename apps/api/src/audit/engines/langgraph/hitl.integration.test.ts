import { INTERRUPT, isInterrupted } from '@langchain/langgraph'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import type { ExtractedInvoice } from '../../extraction'
import { CHECKPOINT_SCHEMA, getCheckpointer } from './checkpointer'
import { buildAuditGraph, type AuditGraphDeps } from './graph'

/**
 * Durable human-in-the-loop (plan: 2026-09-04-p1-phase-b-langgraph-engine, task T9).
 *
 * The genuine graph and a real Postgres, with every model faked: what is under
 * test is whether a run suspends and survives, not what Claude says about an
 * invoice. Needs the local Supabase stack; no credentials.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const sql = postgres(DATABASE_URL, { max: 1 })

afterAll(async () => {
  await sql.end()
})

const extracted: ExtractedInvoice = {
  invoiceNumber: 'INV-HITL-1',
  abn: '51000000680',
  subtotalAud: 1000,
  gstAud: 100,
  totalAud: 1100,
  lines: [
    { itemCode: 'PUMP-100', description: 'Pump', qty: 1, unitPriceAud: 1000, lineTotalAud: 1000 },
  ],
}

function deps(overrides: Partial<AuditGraphDeps> = {}): AuditGraphDeps {
  return {
    extract: async () => extracted,
    // A MATCHING PO, and a rate card the invoice sits on. Without both, this
    // invoice is not actually clean: a missing PO flags, which would make the
    // "never suspends a clean invoice" case pass for the wrong reason.
    loadPo: async () => ({ poNumber: 'PO-HITL-1', totalAud: 1100 }),
    loadRates: async () => [{ itemCode: 'PUMP-100', rateAud: 1000 }],
    judgeContractTerms: async () => ({
      type: 'contract_terms',
      verdict: 'pass',
      evidence: { summary: 'No clauses on file.' },
    }),
    needsHumanReview: () => false,
    ...overrides,
  }
}

const input = (invoiceId: string) => ({
  invoiceId,
  vendorId: crypto.randomUUID(),
  pdfPath: 'INV-HITL-1.pdf',
})

describe('the audit graph pausing for a human', () => {
  it('suspends an invoice that needs review, and says so in what it returns', async () => {
    const invoiceId = crypto.randomUUID()
    const graph = buildAuditGraph(deps({ needsHumanReview: () => true }), await getCheckpointer())

    const values = await graph.invoke(input(invoiceId), {
      configurable: { thread_id: invoiceId },
    })

    // A suspended run RETURNS, it does not throw: the interrupt rides back on the
    // values. Anything reading this must check, or it will treat a paused run as
    // a finished one.
    expect(isInterrupted(values)).toBe(true)
    // Narrow inside the expression: the guard's type REPLACES the state type
    // rather than adding to it, so narrowing `values` outright would lose the
    // state fields asserted below.
    const interrupts = isInterrupted(values) ? values[INTERRUPT] : []
    expect(interrupts[0]?.value).toMatchObject({ invoiceId })

    // The verdict was computed BEFORE the pause and is therefore in the state.
    // If the interrupt lived in `aggregate` this would be undefined, because a
    // node that interrupts never reaches its return statement.
    expect(values.overall).toBe('pass')
    expect(values.checks).toHaveLength(4)
  })

  it('leaves state behind under the invoice id, so another process can resume it', async () => {
    const invoiceId = crypto.randomUUID()
    const graph = buildAuditGraph(deps({ needsHumanReview: () => true }), await getCheckpointer())
    await graph.invoke(input(invoiceId), { configurable: { thread_id: invoiceId } })

    const [row] = await sql<{ n: string }[]>`
      select count(*)::text as n from ${sql(CHECKPOINT_SCHEMA)}.checkpoints
      where thread_id = ${invoiceId}`
    expect(Number(row!.n)).toBeGreaterThan(0)

    // And the engine itself can see it is waiting — this is what the resume path
    // relies on after a restart.
    const snapshot = await graph.getState({ configurable: { thread_id: invoiceId } })
    expect(snapshot.tasks.some((t) => t.interrupts.length > 0)).toBe(true)
  })

  it('never suspends a clean invoice', async () => {
    const invoiceId = crypto.randomUUID()
    const graph = buildAuditGraph(deps(), await getCheckpointer())

    const values = await graph.invoke(input(invoiceId), {
      configurable: { thread_id: invoiceId },
    })

    expect(isInterrupted(values)).toBe(false)
    expect(values.overall).toBe('pass')

    const snapshot = await graph.getState({ configurable: { thread_id: invoiceId } })
    expect(snapshot.tasks.some((t) => t.interrupts.length > 0)).toBe(false)
  })
})
