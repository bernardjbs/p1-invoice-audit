import type { Verdict } from './types'

/**
 * When an audit needs a human (plan: 2026-09-04-p1-phase-b-langgraph-engine, task T9).
 *
 * ONE rule, in one place, because two things now ask the question. The engine
 * asks it to decide whether to suspend itself mid-run, and the worker asks it to
 * decide the invoice's status. Those answers must agree: an engine that pauses
 * while the worker marks the invoice passed would leave a suspended run nobody
 * can see, and the opposite leaves an invoice in the review queue that no
 * approval can resume. Before this existed the rule was inline in the worker, so
 * the engine would have had to grow its own copy.
 */

/** Default variance tolerance; overridden by `AUDIT_VARIANCE_THRESHOLD`. */
export const DEFAULT_VARIANCE_THRESHOLD = 0.05

export function varianceThreshold(): number {
  return Number(process.env.AUDIT_VARIANCE_THRESHOLD ?? String(DEFAULT_VARIANCE_THRESHOLD))
}

/**
 * True when the audit must stop for a person: anything short of a clean pass, or
 * a pass whose price variance is over tolerance.
 */
export function needsHumanReview(
  overall: Verdict,
  variancePct: number,
  threshold: number = varianceThreshold(),
): boolean {
  return !(overall === 'pass' && variancePct <= threshold)
}
