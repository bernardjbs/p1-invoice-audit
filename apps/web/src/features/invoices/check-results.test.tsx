// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
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

// Nothing wires testing-library's auto-cleanup here, so without this each render
// stacks on the previous test's DOM and `screen` queries see both.
afterEach(cleanup)

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
   * The `check-` prefix is a COUNTING namespace, not decoration.
   *
   * The e2e specs count check cards with `[data-testid^="check-"]` and assert
   * exactly four. Any `check-`-prefixed test id added anywhere inside a card is
   * therefore counted as a fifth card and breaks all of them. That happened: the
   * citation's id was first written as `check-source`, and it took a 30-minute
   * e2e job to surface, and only because the mock's `po_match` evidence happens
   * to carry a `sourceRef` at all.
   *
   * This is the same assertion at the unit tier, where a rename fails in seconds.
   * The evidence below deliberately carries every optional field, so a new id on
   * any of them is caught.
   */
  it('exposes exactly four check- prefixed test ids (the e2e card count)', () => {
    const { container } = render(
      <CheckResults
        checks={checks.map((check) => ({
          ...check,
          evidence: {
            ...check.evidence,
            expected: '1.00',
            actual: '2.00',
            sourceRef: 'MSA-1000 §6',
          },
        }))}
      />,
    )
    expect(container.querySelectorAll('[data-testid^="check-"]')).toHaveLength(4)
  })

  /**
   * The contract-terms shape: a citation and NO expected/actual. Every check in
   * the fixture above carries expected/actual alongside its sourceRef, which is
   * how the citation came to be nested inside a guard that required them: the
   * real contract-terms evidence has neither, so a retrieved clause reference was
   * persisted to the database and then dropped by this component. Golden
   * criterion 3 depends on it reaching the page.
   */
  it('renders the citation when the evidence carries only a sourceRef', () => {
    render(
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
    expect(screen.getByTestId('evidence-source').textContent).toBe('MSA-1000 §6')
  })
})
