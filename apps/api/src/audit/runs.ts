import { sql } from '../db/client'
import type { CheckResult, Verdict } from './types'

/**
 * Persistence for audit runs and their check results — part of the seam (plan
 * T5/T6). The `check_type`/`CheckResult` vocabulary lives ONLY here and in the
 * engine (seam-gate.sh enforces it), so reading/writing audit results never
 * leaks check logic into the API or web layers. The worker (T7) writes via
 * `persistAuditRun`; the invoice detail view reads via `readLatestAuditRun`.
 */

export type AuditRunView = {
  engine: string
  overall: Verdict
  variancePct: number
  startedAt: string | null
  finishedAt: string | null
  checks: CheckResult[]
}

/** The latest audit run for an invoice with its four check results, or null. */
export async function readLatestAuditRun(invoiceId: string): Promise<AuditRunView | null> {
  const [run] = await sql<
    { id: string; engine: string; overall: Verdict; variance_pct: string; started_at: string | null; finished_at: string | null }[]
  >`
    select id, engine, overall, variance_pct, started_at::text, finished_at::text
    from audit_runs where invoice_id = ${invoiceId}
    order by started_at desc nulls last limit 1`
  if (!run) return null

  const checks = await sql<{ check_type: CheckResult['type']; verdict: Verdict; evidence: CheckResult['evidence'] }[]>`
    select check_type, verdict, evidence from check_results where audit_run_id = ${run.id}`
  return {
    engine: run.engine,
    overall: run.overall,
    variancePct: Number(run.variance_pct),
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    checks: checks.map((c) => ({ type: c.check_type, verdict: c.verdict, evidence: c.evidence })),
  }
}
