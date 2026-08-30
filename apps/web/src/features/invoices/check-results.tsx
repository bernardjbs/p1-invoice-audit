import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CHECK_LABELS } from './status'
import { VerdictBadge } from './status-badge'
import type { CheckResult } from './types'

/** One audit check rendered with its verdict and evidence (plan T10). */
export function CheckResultCard({ check }: { check: CheckResult }) {
  return (
    <Card data-testid={`check-${check.type}`}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{CHECK_LABELS[check.type] ?? check.type}</CardTitle>
        <VerdictBadge verdict={check.verdict} />
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        <p>{check.evidence.summary}</p>
        {(check.evidence.expected !== undefined || check.evidence.actual !== undefined) && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-muted-foreground">
            {check.evidence.expected !== undefined && (
              <>
                <dt>Expected</dt>
                <dd className="font-mono">{check.evidence.expected}</dd>
              </>
            )}
            {check.evidence.actual !== undefined && (
              <>
                <dt>Actual</dt>
                <dd className="font-mono">{check.evidence.actual}</dd>
              </>
            )}
            {check.evidence.sourceRef !== undefined && (
              <>
                <dt>Source</dt>
                <dd className="font-mono">{check.evidence.sourceRef}</dd>
              </>
            )}
          </dl>
        )}
      </CardContent>
    </Card>
  )
}

/** The four check cards for an audit run. */
export function CheckResults({ checks }: { checks: CheckResult[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {checks.map((check) => (
        <CheckResultCard key={check.type} check={check} />
      ))}
    </div>
  )
}
