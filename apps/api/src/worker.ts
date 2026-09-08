import './config/load-env'
import { auditInvoice, type AuditInvoiceOptions } from './audit/engine'
import { resumeLangGraphEngine } from './audit/engines/langgraph'
import { needsHumanReview, varianceThreshold } from './audit/pause-rule'
import { persistAuditRun } from './audit/runs'
import { sql } from './db/client'
import { invoiceReviewUrl, notifyInvoicePaused } from './notify/slack'
import { archiveJob, readAuditJobs, type AuditJob } from './queue/audit-queue'

/**
 * The background audit worker (plan T7). In dev it long-polls the pgmq queue via
 * `bun run worker`; in prod a pg_cron consumer drives the same processing (T14,
 * docs/pgmq-spike.md). It is the ONLY writer of audit outcomes: read a job →
 * run the seam's `auditInvoice()` → persist the run + four checks → set the
 * invoice status. No check logic here — that all lives behind the seam.
 */

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? '2000')

/**
 * Process one job: audit the invoice, persist the run, set the final status.
 *
 * `opts` is the seam's own options bag, passed straight through. It exists so an
 * integration test can drive this exact code path with fake models instead of
 * paying for a vision call and a judge on every run. Production passes nothing.
 */
async function processJob(job: AuditJob, opts: AuditInvoiceOptions = {}): Promise<void> {
  // A decision came back from a person: continue the suspended run rather than
  // starting a new audit. Nothing is persisted here. The run and its four checks
  // were written when it paused, and the decision row and the invoice's status
  // were written by the approve request before this job was queued, so a
  // redelivered resume repeats no writes. See `enqueueResume` for why this is a
  // job at all.
  if (job.kind === 'resume') {
    const resumed = await resumeLangGraphEngine(
      job.invoiceId,
      job.decision ?? 'approved',
      opts.graphDeps ?? {},
      opts.checkpointer,
    )
    if (!resumed) {
      console.log(`[worker] nothing suspended for invoice ${job.invoiceId}; resume is a no-op`)
    }
    return
  }

  const result = await auditInvoice(job.invoiceId, opts)
  await persistAuditRun(job.invoiceId, result)
  // The SAME rule the langgraph engine uses to suspend itself (`audit/pause-rule.ts`).
  // It has to be the same one: if the engine paused a run while this marked the
  // invoice passed, the suspended run would be invisible with no way to resume it.
  const status = needsHumanReview(result.overall, result.variancePct) ? 'paused_review' : 'passed'
  await sql`update invoices set status = ${status} where id = ${job.invoiceId}`
  if (status === 'paused_review') await announcePause(job.invoiceId, result.variancePct)
}

/**
 * Tell Slack an invoice is waiting for a person.
 *
 * Deliberately AFTER the status write, and deliberately unable to fail: the
 * audit has already succeeded and the invoice is already in the review queue by
 * the time this runs, so a Slack outage must not undo that or make the worker
 * drop the job as poison. `notifyInvoicePaused` swallows its own failures; the
 * try/catch here covers the lookup as well, so the whole notification path is
 * best-effort end to end.
 *
 * Only the `audit` path calls this. A `resume` job returns before it, which is
 * correct: that run already notified when it paused, and re-announcing on every
 * approval would tell the reviewer about work they have just finished.
 */
async function announcePause(invoiceId: string, variancePct: number): Promise<void> {
  try {
    const [row] = await sql<{ invoice_number: string; vendor_name: string }[]>`
      select i.invoice_number, v.name as vendor_name
      from invoices i join vendors v on v.id = i.vendor_id
      where i.id = ${invoiceId}`
    await notifyInvoicePaused({
      invoiceNumber: row?.invoice_number ?? invoiceId,
      vendor: row?.vendor_name ?? 'unknown vendor',
      variancePct,
      url: invoiceReviewUrl(invoiceId),
    })
  } catch (err) {
    console.error(`[worker] pause notification failed for invoice ${invoiceId}:`, err)
  }
}

/** Drain the currently-available jobs once. Returns how many were read. */
export async function runWorkerOnce(opts: AuditInvoiceOptions = {}): Promise<number> {
  const jobs = await readAuditJobs()
  for (const { msgId, job } of jobs) {
    try {
      await processJob(job, opts)
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
  console.log(`audit worker started (threshold ${varianceThreshold()}, poll ${POLL_MS}ms)`)
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
