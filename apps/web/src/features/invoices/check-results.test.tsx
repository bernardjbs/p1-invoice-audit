// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CheckResults } from './check-results'
import type { CheckResult } from './types'

const checks: CheckResult[] = [
  { type: 'math', verdict: 'pass', evidence: { summary: 'Arithmetic balances.' } },
  {
    type: 'price_vs_contract',
    verdict: 'flag',
    evidence: {
      summary: 'Line PUMP-100 over rate.',
      expected: '5000.00',
      actual: '6000.00',
      sourceRef: 'PUMP-100',
    },
  },
  { type: 'po_match', verdict: 'pass', evidence: { summary: 'Matches PO.' } },
  { type: 'contract_terms', verdict: 'fail', evidence: { summary: 'Vendor not approved.' } },
]

describe('CheckResults', () => {
  it('renders a card per check with its verdict and evidence', () => {
    render(<CheckResults checks={checks} />)
    // four cards, one per check type
    expect(screen.getByTestId('check-math')).toBeDefined()
    expect(screen.getByTestId('check-price_vs_contract')).toBeDefined()
    expect(screen.getByTestId('check-po_match')).toBeDefined()
    expect(screen.getByTestId('check-contract_terms')).toBeDefined()
    // evidence detail surfaces
    expect(screen.getByText('Line PUMP-100 over rate.')).toBeDefined()
    expect(screen.getByText('6000.00')).toBeDefined()
    // verdicts render (a Fail label for the unapproved vendor)
    expect(screen.getByText('Fail')).toBeDefined()
  })

  /**
   * The contract-terms shape: a citation and NO expected/actual. Every check
   * above carries expected/actual alongside its sourceRef, which is how the
   * citation came to be nested inside a guard that required them: the real
   * contract-terms evidence has neither, so a retrieved clause reference was
   * persisted to the database and then dropped by this component. Golden
   * criterion 3 depends on it reaching the page.
   */
  it('renders the citation when the evidence carries only a sourceRef', () => {
    // Scoped with `within(container)`: there is no global auto-cleanup here, and
    // `render`'s own queries are bound to document.body, so both would still see
    // the previous test's cards.
    const { container } = render(
      <CheckResults
        checks={[
          {
            type: 'contract_terms',
            verdict: 'fail',
            evidence: {
              summary: 'Weekend call-out loading is not permitted without prior written approval.',
              sourceRef: 'MSA-1000 §6',
            },
          },
        ]}
      />,
    )
    expect(within(container).getByTestId('evidence-source').textContent).toBe('MSA-1000 §6')
  })
})
