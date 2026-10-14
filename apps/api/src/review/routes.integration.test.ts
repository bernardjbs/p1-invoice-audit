import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../app'
import { sql } from '../db/client'
import { resetStaleDecisions, SEEDED_RESET_MINUTES } from '../invoices/sample-cleanup'
import { enqueueAudit } from '../queue/audit-queue'
import { runWorkerOnce } from '../worker'

/**
 * Review endpoints — HITL as a status-flag flow (plan T8, criterion 5).
 * Integration tier: local Supabase up + seeded. beforeAll drives a real audit on
 * the unapproved-vendor invoice so it lands paused_review with a persisted run.
 */

let pausedId: string
let pausedNumber: string
let receivedId: string

beforeAll(async () => {
  const [unapproved] = await sql<{ id: string; invoice_number: string }[]>`
    select i.id, i.invoice_number from invoices i join vendors v on v.id = i.vendor_id
    where v.is_approved = false limit 1`
  pausedId = unapproved!.id
  pausedNumber = unapproved!.invoice_number
  await enqueueAudit(pausedId)
  // Drain the queue rather than read it once. One read takes ten jobs, and
  // other files can leave jobs behind (for invoices they have since deleted),
  // which then fill every slot and leave this invoice unaudited. Bounded so a
  // queue that keeps refilling fails the tests instead of hanging them.
  for (let round = 0; round < 20; round++) {
    if ((await runWorkerOnce()) === 0) break
  }

  const [received] = await sql<
    { id: string }[]
  >`select id from invoices where invoice_number = 'INV-0001'`
  receivedId = received!.id
})

afterAll(async () => {
  await sql`delete from review_decisions where invoice_id = ${pausedId}`
  await sql`delete from audit_runs where invoice_id = ${pausedId}`
  await sql`update invoices set status = 'received' where id = ${pausedId}`
})

describe('GET /api/review-queue', () => {
  it('lists invoices paused for review', async () => {
    const res = await app.request('/api/review-queue')
    expect(res.status).toBe(200)
    const rows = (await res.json()) as { id: string; status: string; variancePct: number }[]
    expect(rows.some((r) => r.id === pausedId)).toBe(true)
    expect(rows.every((r) => r.status === 'paused_review')).toBe(true)
  })
})

describe('POST /api/invoices/:id/review', () => {
  it('records an approval, sets the invoice approved, and clears it from the queue', async () => {
    const res = await app.request(`/api/invoices/${pausedId}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approved', note: 'ok after review' }),
    })
    expect(res.status).toBe(200)

    const [inv] = await sql<
      { status: string }[]
    >`select status from invoices where id = ${pausedId}`
    expect(inv!.status).toBe('approved')

    const [decision] = await sql<{ decision: string; note: string }[]>`
      select decision, note from review_decisions where invoice_id = ${pausedId}`
    expect(decision!.decision).toBe('approved')
    expect(decision!.note).toBe('ok after review')

    const queue = (await (await app.request('/api/review-queue')).json()) as { id: string }[]
    expect(queue.some((r) => r.id === pausedId)).toBe(false)
  })

  it('409s a review on an invoice that is not paused_review', async () => {
    const res = await app.request(`/api/invoices/${receivedId}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approved' }),
    })
    expect(res.status).toBe(409)
  })

  it('400s an invalid decision', async () => {
    const res = await app.request(`/api/invoices/${receivedId}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'maybe' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('a second approval after the demo reset', () => {
  const approve = () =>
    app.request(`/api/invoices/${pausedId}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approved' }),
    })
  const statusOf = async () => {
    const [inv] = await sql<
      { status: string }[]
    >`select status from invoices where id = ${pausedId}`
    return inv!.status
  }

  it('records a new decision, and the worker resumes nothing because no run is waiting', async () => {
    // Start where beforeAll left this invoice: paused, with its audit run and no
    // decision. The approval test above has already decided it, so undo that here
    // rather than depend on the order the tests run in.
    await sql`delete from review_decisions where invoice_id = ${pausedId}`
    await sql`update invoices set status = 'paused_review' where id = ${pausedId}`

    expect((await approve()).status).toBe(200)

    // Age the decision past the reset window instead of waiting it out.
    await sql`
      update review_decisions
      set decided_at = now() - make_interval(mins => ${SEEDED_RESET_MINUTES + 1})
      where invoice_id = ${pausedId}`
    const { reset } = await resetStaleDecisions()
    expect(reset).toContain(pausedNumber)
    expect(await statusOf()).toBe('paused_review')

    // The second visitor's approval: accepted, and recorded beside the first.
    expect((await approve()).status).toBe(200)
    expect(await statusOf()).toBe('approved')
    const [decisions] = await sql<{ count: number }[]>`
      select count(*)::int as count from review_decisions where invoice_id = ${pausedId}`
    expect(decisions!.count).toBe(2)

    // Each approval queued a resume. Under the mock engine nothing ever suspends,
    // so there is no run to resume: the worker must say so and change nothing.
    // runWorkerOnce swallows a job's error into console.error, so "did not throw"
    // is checked there, not by the await below.
    const log = vi.spyOn(console, 'log')
    const error = vi.spyOn(console, 'error')
    try {
      expect(await runWorkerOnce()).toBeGreaterThan(0)
      const noOp = `[worker] nothing suspended for invoice ${pausedId}; resume is a no-op`
      expect(log.mock.calls.map((c) => c[0])).toContain(noOp)
      const dropped = error.mock.calls.filter((c) => String(c[0]).includes(pausedId))
      expect(dropped).toEqual([])
    } finally {
      log.mockRestore()
      error.mockRestore()
    }
    expect(await statusOf()).toBe('approved')
  })
})
