import { HTTPException } from 'hono/http-exception'
import { sql } from '../db/client'

/**
 * Review services (plan T8) — HITL as a status-flag flow. The queue is the set
 * of invoices in `paused_review`; a decision records a row and moves the invoice
 * to `approved`/`rejected`. No durable-checkpointer HITL in Phase A (that is
 * Phase B); this is the simple, swappable version.
 */

export type ReviewQueueRow = {
  id: string
  invoiceNumber: string
  vendorName: string
  totalAud: number
  variancePct: number | null
  status: string
}

export async function listReviewQueue(): Promise<ReviewQueueRow[]> {
  const rows = await sql<
    { id: string; invoice_number: string; vendor_name: string; total_aud: string; variance_pct: string | null; status: string }[]
  >`
    select i.id, i.invoice_number, v.name as vendor_name, i.total_aud, i.status,
           (select ar.variance_pct from audit_runs ar
            where ar.invoice_id = i.id order by ar.started_at desc nulls last limit 1) as variance_pct
    from invoices i
    join vendors v on v.id = i.vendor_id
    where i.status = 'paused_review'
    order by i.invoice_number`
  return rows.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoice_number,
    vendorName: r.vendor_name,
    totalAud: Number(r.total_aud),
    variancePct: r.variance_pct === null ? null : Number(r.variance_pct),
    status: r.status,
  }))
}

export type ReviewDecision = 'approved' | 'rejected'

/**
 * Record a review decision on a paused invoice and set its status. Rejects (409)
 * any invoice that is not currently paused_review — decisions are only valid on
 * the review queue.
 */
export async function submitReview(invoiceId: string, decision: ReviewDecision, note?: string): Promise<void> {
  const [invoice] = await sql<{ status: string }[]>`select status from invoices where id = ${invoiceId}`
  if (!invoice) throw new HTTPException(404, { message: 'invoice not found' })
  if (invoice.status !== 'paused_review') {
    throw new HTTPException(409, { message: `invoice is ${invoice.status}, not paused_review` })
  }

  const [run] = await sql<{ id: string }[]>`
    select id from audit_runs where invoice_id = ${invoiceId} order by started_at desc nulls last limit 1`

  await sql.begin(async (tx) => {
    await tx`
      insert into review_decisions (invoice_id, audit_run_id, decision, note, decided_at)
      values (${invoiceId}, ${run?.id ?? null}, ${decision}, ${note ?? null}, now())`
    await tx`update invoices set status = ${decision} where id = ${invoiceId}`
  })
}
