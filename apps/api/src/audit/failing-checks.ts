import type { AuditResult } from './types'

/**
 * The human-readable names of the checks that did not pass, for the Slack
 * pause notification.
 *
 * WHY IT LIVES BEHIND THE SEAM. Only this folder may name check types
 * (`scripts/seam-gate.sh`). The notifier and the worker therefore receive a
 * plain `string[]` and know nothing about what a check is, which keeps the
 * Phase B drop-in property intact: a different engine can produce different
 * checks and this is the only file that needs to learn their names.
 *
 * WHY IT EXISTS AT ALL. The notification led with price variance and nothing
 * else, so a clause breach arrived in Slack reading "paused for review — price
 * variance 0.0%", which tells a reviewer that nothing is wrong. Observed on the
 * first live pause, 2026-09-23: the invoice was arithmetically perfect and
 * billed at the contracted rate, and had breached a contract clause.
 */
const LABELS = {
  math: 'arithmetic',
  price_vs_contract: 'price vs contract',
  po_match: 'PO match',
  contract_terms: 'contract terms',
} as const

export function failingCheckLabels(result: AuditResult): string[] {
  return result.checks.filter((c) => c.verdict !== 'pass').map((c) => LABELS[c.type])
}
