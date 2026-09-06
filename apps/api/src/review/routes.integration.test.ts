import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../app'
import { sql } from '../db/client'
import { enqueueAudit } from '../queue/audit-queue'
import { runWorkerOnce } from '../worker'

/**
 * Review endpoints — HITL as a status-flag flow (plan T8, criterion 5).
 * Integration tier: local Supabase up + seeded. beforeAll drives a real audit on
 * the unapproved-vendor invoice so it lands paused_review with a persisted run.
 */

let pausedId: string
let receivedId: string

beforeAll(async () => {
  const [unapproved] = await sql<{ id: string }[]>`
    select i.id from invoices i join vendors v on v.id = i.vendor_id
    where v.is_approved = false limit 1`
  pausedId = unapproved!.id
  await enqueueAudit(pausedId)
  await runWorkerOnce()

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
