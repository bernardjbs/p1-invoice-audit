import type { InvoiceListItem, InvoiceStatus, Verdict } from './types'

/**
 * Presentation metadata for invoice statuses and audit verdicts, plus the pure
 * count helper the dashboard uses. `tone` maps to a shadcn Badge variant.
 */
type Tone = 'default' | 'secondary' | 'destructive' | 'outline'

export const STATUS_META: Record<InvoiceStatus, { label: string; tone: Tone }> = {
  received: { label: 'Received', tone: 'secondary' },
  auditing: { label: 'Auditing', tone: 'outline' },
  passed: { label: 'Passed', tone: 'default' },
  flagged: { label: 'Flagged', tone: 'destructive' },
  paused_review: { label: 'Paused for review', tone: 'destructive' },
  approved: { label: 'Approved', tone: 'default' },
  rejected: { label: 'Rejected', tone: 'destructive' },
}

export const VERDICT_META: Record<Verdict, { label: string; tone: Tone }> = {
  pass: { label: 'Pass', tone: 'default' },
  flag: { label: 'Flag', tone: 'destructive' },
  fail: { label: 'Fail', tone: 'destructive' },
}

export const CHECK_LABELS: Record<string, string> = {
  math: 'Arithmetic',
  price_vs_contract: 'Price vs contract',
  po_match: 'PO match',
  contract_terms: 'Contract / vendor',
}

const ZERO: Record<InvoiceStatus, number> = {
  received: 0,
  auditing: 0,
  passed: 0,
  flagged: 0,
  paused_review: 0,
  approved: 0,
  rejected: 0,
}

/** Tally a list of invoices by status (dashboard cards). */
export function countByStatus(invoices: InvoiceListItem[]): Record<InvoiceStatus, number> {
  const counts = { ...ZERO }
  for (const inv of invoices) counts[inv.status] += 1
  return counts
}
