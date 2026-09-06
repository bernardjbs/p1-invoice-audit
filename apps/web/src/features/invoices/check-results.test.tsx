// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
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
})
