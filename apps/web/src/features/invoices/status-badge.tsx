import { Badge } from '@/components/ui/badge'
import { STATUS_META, VERDICT_META } from './status'
import type { InvoiceStatus, Verdict } from './types'

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  const meta = STATUS_META[status]
  return <Badge variant={meta.tone}>{meta.label}</Badge>
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const meta = VERDICT_META[verdict]
  return <Badge variant={meta.tone}>{meta.label}</Badge>
}
