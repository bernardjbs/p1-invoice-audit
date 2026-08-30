import { sql } from '../db/client'

/**
 * The audit-job queue seam (plan T7, CONVENTIONS §22). All pgmq access goes
 * through these functions so the queue engine can be swapped without touching
 * call sites. The queue itself is created by a migration (create_audit_queue).
 */

export const QUEUE = 'audit_jobs'

export type AuditJob = { invoiceId: string }
export type QueuedJob = { msgId: number; job: AuditJob; readCt: number }

/** Enqueue an audit job for one invoice. Returns the pgmq message id. */
export async function enqueueAudit(invoiceId: string): Promise<number> {
  const [row] = await sql<{ send: number }[]>`
    select pgmq.send(${QUEUE}, ${sql.json({ invoiceId })}) as send`
  return row!.send
}

/**
 * Read up to `qty` jobs, hiding them for `vtSeconds` (visibility timeout) so a
 * crash re-delivers them. Caller archives each on success.
 */
export async function readAuditJobs(qty = 10, vtSeconds = 30): Promise<QueuedJob[]> {
  const rows = await sql<{ msg_id: number; message: AuditJob; read_ct: number }[]>`
    select msg_id, message, read_ct from pgmq.read(${QUEUE}, ${vtSeconds}, ${qty})`
  return rows.map((r) => ({ msgId: r.msg_id, job: r.message, readCt: r.read_ct }))
}

/** Archive a processed message (moves it out of the active queue). */
export async function archiveJob(msgId: number): Promise<void> {
  await sql`select pgmq.archive(${QUEUE}, ${msgId}::bigint)`
}

/** Current active queue depth (excludes archived) — used by tests. */
export async function queueDepth(): Promise<number> {
  const [row] = await sql<{ n: number }[]>`select count(*)::int as n from pgmq.q_audit_jobs`
  return row!.n
}
