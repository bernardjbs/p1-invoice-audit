import postgres from 'postgres'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditGraphDeps } from './audit/engines/langgraph/graph'
import type { ExtractedInvoice } from './audit/extraction'
import { enqueueAudit } from './queue/audit-queue'
import { runWorkerOnce } from './worker'

/**
 * A broken notification must never cost a finished audit.
 *
 * The rule is stated in `notify/slack.ts` and has been true since Phase A by
 * construction: the audit and the status write both complete before anything is
 * announced, and the announcement swallows its own failures. Nothing tested it.
 *
 * It was broken and restored on 2026-09-23 within one commit, which is why this
 * file exists. Adding the failing-check names to the message put one step of the
 * notification path — computing those names — in the caller's ARGUMENT LIST,
 * outside the catch that covers the rest. It could not realistically throw, and
 * "it cannot throw" is exactly the reasoning the rule refuses: the path is
 * best-effort so that no part of it has to be audited for throwing.
 *
 * WHAT THIS ACTUALLY ASSERTS, and what it deliberately does not. Today the two
 * placements leave IDENTICAL database state: the audit and the status write
 * both complete first, the worker's own per-job catch swallows whatever escapes
 * `processJob`, and the job is archived either way. A first version of this test
 * asserted the end state and passed with the bug reinstated — it was decoration,
 * and it is recorded here because that is the failure this repo keeps finding.
 *
 * The difference that IS observable is which failure gets reported. Behind the
 * catch the worker says the NOTIFICATION failed and carries on; in front of it
 * the worker says it is DROPPING THE JOB as poison, about an audit that
 * succeeded. That is a real lie to whoever reads the logs, and it is what this
 * asserts. It also pins the placement, so the latent half — any statement added
 * after the announcement being skipped — cannot creep back unnoticed.
 */

vi.mock('./audit/failing-checks', () => ({
  failingCheckLabels: () => {
    throw new Error('deliberate: the first step of the notification path')
  },
}))

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const sql = postgres(DATABASE_URL, { max: 1 })

const extracted: ExtractedInvoice = {
  invoiceNumber: 'INV-NOTIFY-FAIL',
  abn: '51000000680',
  subtotalAud: 1000,
  gstAud: 100,
  totalAud: 1100,
  lines: [
    { itemCode: 'PUMP-100', description: 'Pump', qty: 1, unitPriceAud: 1000, lineTotalAud: 1000 },
  ],
}

/**
 * Deps that force a pause: the billed total disagrees with the purchase order,
 * which is what sends the invoice to review and therefore what triggers the
 * notification this file is about.
 */
const graphDeps: Partial<AuditGraphDeps> = {
  extract: async () => extracted,
  loadPo: async () => ({ poNumber: 'PO-NOTIFY-1', totalAud: 9999 }),
  loadRates: async () => [{ itemCode: 'PUMP-100', rateAud: 1000 }],
  judgeContractTerms: async () => ({
    type: 'contract_terms',
    verdict: 'fail',
    evidence: { summary: 'A clause forbids this charge.', sourceRef: 'MSA-1 §6' },
  }),
}

let invoiceId: string
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
})

afterAll(async () => {
  if (invoiceId) await sql`delete from invoices where id = ${invoiceId}`
  await sql.end()
})

describe('an audit whose notification throws', () => {
  it('reports a failed notification, not a dropped job, and leaves the invoice reviewable', async () => {
    const [vendor] = await sql<{ id: string }[]>`select id from vendors order by name limit 1`
    const [row] = await sql<{ id: string }[]>`
      insert into invoices (vendor_id, invoice_number, invoice_date, due_date,
                            subtotal_aud, gst_aud, total_aud, status, pdf_path)
      values (${vendor!.id}, ${`INV-NOTIFY-${crypto.randomUUID().slice(0, 8)}`},
              current_date, current_date + 30, 1000, 100, 1100, 'received', 'INV-0001.pdf')
      returning id`
    invoiceId = row!.id
    await enqueueAudit(invoiceId)

    // The worker must not reject: a throwing notification is not a poison job.
    await expect(runWorkerOnce({ engine: 'langgraph', graphDeps })).resolves.toBeGreaterThan(0)

    const [invoice] = await sql<{ status: string }[]>`
      select status from invoices where id = ${invoiceId}`
    expect(invoice!.status, 'the invoice should still be waiting for a person').toBe(
      'paused_review',
    )

    const [run] = await sql<{ n: number }[]>`
      select count(*)::int n from audit_runs where invoice_id = ${invoiceId}`
    expect(run!.n, 'the audit run should still have been persisted').toBe(1)

    /**
     * The assertion that distinguishes the two placements. Both leave the state
     * above identical; only this says whether the worker understood that the
     * audit succeeded and the announcement failed.
     */
    const logged = errorSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n')
    expect(logged, 'the notification failure should be reported as such').toContain(
      'pause notification failed',
    )
    expect(logged, 'a successful audit must never be reported as a dropped job').not.toContain(
      'dropping job',
    )
  })
})
