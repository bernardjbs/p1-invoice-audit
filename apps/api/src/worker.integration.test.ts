import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from './app'
import { sql } from './db/client'
import { enqueueAudit, queueDepth, queueDepthForInvoices } from './queue/audit-queue'
import { runWorkerOnce } from './worker'

/**
 * Queue-driven audit worker (plan T7, criterion 4 at API level). Integration
 * tier: local Supabase up + seeded. Deterministic — each test enqueues then
 * drains one worker tick, so there is no sleep/poll timing.
 */

async function invoiceId(number: string): Promise<string> {
  const [row] = await sql<
    { id: string }[]
  >`select id from invoices where invoice_number = ${number}`
  return row!.id
}

let cleanId: string
let unapprovedId: string

beforeAll(async () => {
  cleanId = await invoiceId('INV-0001')
  const [row] = await sql<{ id: string }[]>`
    select i.id from invoices i join vendors v on v.id = i.vendor_id
    where v.is_approved = false limit 1`
  unapprovedId = row!.id
})

// Restore the seeded invoices this file mutates so the tier is re-runnable
// without a reset (audit_runs cascade-delete their check_results).
afterAll(async () => {
  await sql`delete from audit_runs where invoice_id in ${sql([cleanId, unapprovedId])}`
  await sql`update invoices set status = 'received' where id in ${sql([cleanId, unapprovedId])}`
})

describe('POST /api/invoices/:id/audit', () => {
  it('enqueues a job and sets the invoice auditing', async () => {
    const before = await queueDepth()
    const res = await app.request(`/api/invoices/${cleanId}/audit`, { method: 'POST' })
    expect(res.status).toBe(202)
    expect(await queueDepth()).toBe(before + 1)
    const [row] = await sql<{ status: string }[]>`select status from invoices where id = ${cleanId}`
    expect(row!.status).toBe('auditing')
    // drain so the queue is clean for the next test
    await runWorkerOnce()
  })
})

describe('runWorkerOnce', () => {
  it('audits a clean invoice → passed, with a run and four check results', async () => {
    await enqueueAudit(cleanId)
    const processed = await runWorkerOnce()
    expect(processed).toBeGreaterThanOrEqual(1)

    const [inv] = await sql<{ status: string }[]>`select status from invoices where id = ${cleanId}`
    expect(inv!.status).toBe('passed')

    const [run] = await sql<{ id: string; overall: string }[]>`
      select id, overall from audit_runs where invoice_id = ${cleanId} order by started_at desc limit 1`
    expect(run!.overall).toBe('pass')
    const [count] = await sql<{ n: number }[]>`
      select count(*)::int as n from check_results where audit_run_id = ${run!.id}`
    expect(count!.n).toBe(4)
  })

  it('audits an unapproved-vendor invoice → paused_review, with four check results', async () => {
    await enqueueAudit(unapprovedId)
    await runWorkerOnce()

    const [inv] = await sql<
      { status: string }[]
    >`select status from invoices where id = ${unapprovedId}`
    expect(inv!.status).toBe('paused_review')

    const [run] = await sql<{ id: string; overall: string }[]>`
      select id, overall from audit_runs where invoice_id = ${unapprovedId} order by started_at desc limit 1`
    expect(run!.overall).not.toBe('pass')
    const [count] = await sql<{ n: number }[]>`
      select count(*)::int as n from check_results where audit_run_id = ${run!.id}`
    expect(count!.n).toBe(4)
  })

  it('leaves none of its own jobs queued after draining', async () => {
    // Scoped to THIS file's invoices on purpose. The global depth is not a
    // property this spec can assert: the restart spec leaves a deliberately
    // in-flight job behind (read, unarchived, hidden until its visibility
    // timeout expires), so a global "queue is empty" check passed or failed on
    // timing alone. What this file can honestly claim is that it drained what
    // it enqueued.
    expect(await queueDepthForInvoices([cleanId, unapprovedId])).toBe(0)
  })
})
