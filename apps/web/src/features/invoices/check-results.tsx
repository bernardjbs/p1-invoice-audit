import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CHECK_LABELS } from './status'
import { VerdictBadge } from './status-badge'
import type { CheckResult } from './types'

/** One audit check rendered with its verdict and evidence (plan T10). */
export function CheckResultCard({ check }: { check: CheckResult }) {
  return (
    <Card data-testid={`check-${check.type}`}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">
          {CHECK_LABELS[check.type] ?? check.type}
        </CardTitle>
        <VerdictBadge verdict={check.verdict} />
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        <p>{check.evidence.summary}</p>
        {/*
          `sourceRef` has to be in this guard, not just in the body. It was
          omitted, and the contract-terms check is the one evidence shape that
          carries a citation and NO expected/actual, so the clause reference it
          retrieved reached the database and then died here: the run persisted
          `MSA-1000 §6` while the card rendered no Source row at all. That is
          golden criterion 3 failing at the view layer, invisibly.
        */}
        {(check.evidence.expected !== undefined ||
          check.evidence.actual !== undefined ||
          check.evidence.sourceRef !== undefined) && (
          <dl className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3">
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
                {/*
                  NOT `check-source`. The specs count the check cards with
                  `[data-testid^="check-"]`, so a `check-`-prefixed id anywhere
                  inside a card is counted as a fifth card and breaks every
                  four-card assertion. Measured: it did.
                */}
                <dd className="font-mono" data-testid="evidence-source">
                  {check.evidence.sourceRef}
                </dd>
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
