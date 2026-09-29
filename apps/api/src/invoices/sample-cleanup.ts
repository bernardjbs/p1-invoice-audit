import { sql } from '../db/client'
import { deleteInvoicePdfs } from '../lib/storage'

/**
 * The scheduled tidy-up for the sample invoices a visitor uploads from the
 * upload page, and the availability the page reads to show what is taken.
 *
 * WHY A PREFIX AND NOTHING ELSE. The prefix is the only thing standing between
 * this and real data, so it is hardcoded and nothing can widen it: the cleanup
 * takes no argument naming what to delete. A destructive job reachable over
 * HTTP earns a rail that no caller can move.
 *
 * WHY AN AGE AND NOT JUST THE PREFIX. Deleting every sample on sight would take
 * one out from under a visitor who uploaded it a minute earlier and is watching
 * its audit run. Only samples past their time are eligible.
 */

/** Every sample invoice is numbered from this. The PDF generator imports it. */
export const SAMPLE_PREFIX = 'INV-DEMO-'

/**
 * How long a sample is left alone after it is uploaded. Also what the upload
 * page counts down to, so the two cannot disagree: one value, read by both.
 */
export const SAMPLE_TTL_MINUTES = Number(process.env.SAMPLE_TTL_MINUTES ?? 120)

/**
 * Starting with the prefix is not enough — a number that merely contains it
 * must be refused, or a real invoice called `X-INV-DEMO-1` would be in scope.
 */
export function isSampleInvoiceNumber(n: string): boolean {
  return n.startsWith(SAMPLE_PREFIX) && n.length > SAMPLE_PREFIX.length
}

export type SampleHold = {
  invoiceNumber: string
  /** When the sweep becomes entitled to remove it. */
  freesAt: string
}

/**
 * Which sample numbers are currently taken, and when each stops being taken.
 *
 * Read by the upload page to disable a sample's button and show the countdown,
 * rather than letting a visitor press it and meet a 409 they did not cause. In
 * production the row is shared, so the visitor who is blocked is usually not
 * the visitor who uploaded it.
 */
export async function listSampleHolds(): Promise<SampleHold[]> {
  const rows = await sql<{ invoice_number: string; frees_at: Date }[]>`
    select invoice_number,
           created_at + make_interval(mins => ${SAMPLE_TTL_MINUTES}) as frees_at
    from invoices
    where invoice_number like ${`${SAMPLE_PREFIX}%`}
    order by invoice_number`
  return rows.map((r) => ({ invoiceNumber: r.invoice_number, freesAt: r.frees_at.toISOString() }))
}

export type SweepResult = { removed: string[]; pdfsRemoved: number }

/**
 * Remove every sample invoice past its time, and the PDF each one stored.
 *
 * The rows go first. If the storage delete then fails the result says so rather
 * than throwing: a stranded PDF is litter, while a half-done sweep that reports
 * failure would be re-run and delete nothing, because the rows are already gone.
 */
export async function sweepExpiredSamples(): Promise<SweepResult> {
  const doomed = await sql<{ id: string; invoice_number: string; pdf_path: string | null }[]>`
    select id, invoice_number, pdf_path
    from invoices
    where invoice_number like ${`${SAMPLE_PREFIX}%`}
      and created_at < now() - make_interval(mins => ${SAMPLE_TTL_MINUTES})`
  // Defence in depth, not belt and braces for its own sake: the `like` pattern
  // above also matches the bare prefix, and a future edit widening it would be
  // invisible. Every row is re-checked against the predicate before anything is
  // deleted, so the rail holds even if the query stops holding it.
  const safe = doomed.filter((r) => isSampleInvoiceNumber(r.invoice_number))
  if (!safe.length) return { removed: [], pdfsRemoved: 0 }

  // Child rows (lines, audit runs, review decisions) cascade.
  await sql`delete from invoices where id = any(${safe.map((r) => r.id)})`

  const paths = safe.map((r) => r.pdf_path).filter((p): p is string => Boolean(p))
  const pdfsRemoved = paths.length ? await deleteInvoicePdfs(paths) : 0
  return { removed: safe.map((r) => r.invoice_number), pdfsRemoved }
}
