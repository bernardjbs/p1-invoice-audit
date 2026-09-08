import { sql } from '../db/client'

/**
 * The audit-job queue seam (plan T7, CONVENTIONS §22). All pgmq access goes
 * through these functions so the queue engine can be swapped without touching
 * call sites. The queue itself is created by a migration (create_audit_queue).
 */

export const QUEUE = 'audit_jobs'

/**
 * A unit of background work.
 *
 * `kind` is optional so messages written before it existed still read correctly:
 * an absent kind means `audit`, which is what they all were. Do not make it
 * required without draining the queue first.
 */
export type AuditJob = { invoiceId: string; kind?: 'audit' | 'resume'; decision?: string }
export type QueuedJob = { msgId: number; job: AuditJob; readCt: number }

/** Enqueue an audit job for one invoice. Returns the pgmq message id. */
export async function enqueueAudit(invoiceId: string): Promise<number> {
  const [row] = await sql<{ send: number }[]>`
    select pgmq.send(${QUEUE}, ${sql.json({ invoiceId, kind: 'audit' })}) as send`
  return row!.send
}

/**
 * Enqueue the continuation of a suspended audit after a person has decided.
 *
 * Why this is a queued job rather than work done inside the approve request
 * (RULED 2026-09-08): approving is the one moment a person's decision must not
 * be lost. Splitting it makes "the decision is recorded" and "the run finished"
 * two separate facts, so a failure to resume retries on its own instead of
 * either losing the decision or leaving it written with a half-finished run
 * behind it. Latency was measured and is not the argument: the work left after
 * the pause is one state read and a comparison.
 */
export async function enqueueResume(invoiceId: string, decision: string): Promise<number> {
  const [row] = await sql<{ send: number }[]>`
    select pgmq.send(${QUEUE}, ${sql.json({ invoiceId, kind: 'resume', decision })}) as send`
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

/**
 * Active queue depth for specific invoices only.
 *
 * Exists because `queueDepth()` is global, and a spec asserting the global depth
 * is zero cannot be made reliable: `worker-restart.integration.test.ts` SIGKILLs
 * a worker AFTER it has read a job and BEFORE it can archive it, which is the
 * whole point of that test — the job survives, hidden by its visibility timeout,
 * until redelivery. It is a row in the queue that no drain can see, so a later
 * spec's "the queue is empty" assertion failed or passed purely on how much of
 * the 30-second timeout had elapsed. Measured 2026-09-08: one run in three.
 *
 * A spec that wants to prove IT left nothing behind must therefore ask about its
 * OWN jobs, not the queue as a whole.
 */
export async function queueDepthForInvoices(invoiceIds: string[]): Promise<number> {
  if (invoiceIds.length === 0) return 0
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from pgmq.q_audit_jobs
    where message->>'invoiceId' in ${sql(invoiceIds)}`
  return row!.n
}
