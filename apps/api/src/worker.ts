import './config/load-env'
import { auditInvoice } from './audit/engine'
import { persistAuditRun } from './audit/runs'
import { sql } from './db/client'
import { archiveJob, readAuditJobs, type AuditJob } from './queue/audit-queue'

/**
 * The background audit worker (plan T7). In dev it long-polls the pgmq queue via
 * `bun run worker`; in prod a pg_cron consumer drives the same processing (T14,
 * docs/pgmq-spike.md). It is the ONLY writer of audit outcomes: read a job →
 * run the seam's `auditInvoice()` → persist the run + four checks → set the
 * invoice status. No check logic here — that all lives behind the seam.
 */

const VARIANCE_THRESHOLD = Number(process.env.AUDIT_VARIANCE_THRESHOLD ?? '0.05')
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? '2000')

/** Process one job: audit the invoice, persist the run, set the final status. */
async function processJob(job: AuditJob): Promise<void> {
  const result = await auditInvoice(job.invoiceId)
  await persistAuditRun(job.invoiceId, result)
  // Pass only when the audit is clean AND within the variance threshold;
  // anything else pauses for human review (plan T7).
  const status =
    result.overall === 'pass' && result.variancePct <= VARIANCE_THRESHOLD ? 'passed' : 'paused_review'
  await sql`update invoices set status = ${status} where id = ${job.invoiceId}`
}

/** Drain the currently-available jobs once. Returns how many were read. */
export async function runWorkerOnce(): Promise<number> {
  const jobs = await readAuditJobs()
  for (const { msgId, job } of jobs) {
    try {
      await processJob(job)
    } catch (err) {
      // Poison message (e.g. invoice deleted) — drop it so the loop keeps
      // draining rather than stalling. A real DLQ (read_ct routing) is a Phase-B
      // queue-hardening item (docs/pgmq-spike.md).
      console.error(`[worker] dropping job for invoice ${job.invoiceId}:`, err)
    }
    await archiveJob(msgId)
  }
  return jobs.length
}

async function loop(): Promise<void> {
  console.log(`audit worker started (threshold ${VARIANCE_THRESHOLD}, poll ${POLL_MS}ms)`)
  for (;;) {
    const n = await runWorkerOnce()
    if (n > 0) console.log(`processed ${n} audit job(s)`)
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}

// Only run the loop when executed directly (`bun run worker`), not on import.
if (import.meta.main) {
  loop().catch((err) => {
    console.error('[worker] fatal', err)
    process.exit(1)
  })
}
