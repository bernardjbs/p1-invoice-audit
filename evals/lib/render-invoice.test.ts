import { describe, expect, it } from 'vitest'
import type { ExtractedInvoice } from '../../apps/api/src/audit/extraction'
import { renderInvoice } from './render-invoice'

/**
 * The judge scores a summary against the documents it is shown. Those documents
 * are the contract clauses plus this rendering, so anything a good summary is
 * allowed to claim about the invoice has to be findable in here as text.
 *
 * That is the whole contract, and it is why these assertions look like string
 * searches rather than a snapshot: the requirement is "the fact is present and
 * readable", not "the layout is this".
 */

const INVOICE: ExtractedInvoice = {
  invoiceNumber: 'INV-0021',
  abn: '51 824 753 556',
  subtotalAud: 13850,
  gstAud: 1385,
  totalAud: 15235,
  lines: [
    {
      itemCode: 'PUMP-100',
      description: 'Centrifugal slurry pump',
      qty: 1,
      unitPriceAud: 13000,
      lineTotalAud: 13000,
    },
    {
      itemCode: 'CALLOUT-WE',
      description: 'Weekend call-out loading',
      qty: 1,
      unitPriceAud: 850,
      lineTotalAud: 850,
    },
  ],
}

describe('renderInvoice', () => {
  it('names the invoice it is rendering', () => {
    expect(renderInvoice(INVOICE)).toContain('INV-0021')
  })

  it('carries every line item description, so a summary can say what was charged for', () => {
    const rendered = renderInvoice(INVOICE)
    expect(rendered).toContain('Centrifugal slurry pump')
    expect(rendered).toContain('Weekend call-out loading')
  })

  it('carries every line item code', () => {
    const rendered = renderInvoice(INVOICE)
    expect(rendered).toContain('PUMP-100')
    expect(rendered).toContain('CALLOUT-WE')
  })

  it('carries the amount a summary would quote for the breaching line', () => {
    // The real prose for this invoice says "a weekend call-out loading charge
    // of $850". Unless that figure is in the rendering, the claim is scored as
    // unsupported and a correct answer is marked down.
    expect(renderInvoice(INVOICE)).toContain('850.00')
  })

  it('carries the totals', () => {
    const rendered = renderInvoice(INVOICE)
    expect(rendered).toContain('13850.00')
    expect(rendered).toContain('1385.00')
    expect(rendered).toContain('15235.00')
  })

  it('formats money to two decimal places, so a whole-dollar amount is not read as a count', () => {
    expect(renderInvoice(INVOICE)).not.toContain('$850 ')
    expect(renderInvoice(INVOICE)).toContain('$850.00')
  })

  it('keeps quantity separate from money', () => {
    expect(renderInvoice(INVOICE)).toMatch(/qty 1\b/)
  })

  it('is deterministic, so an unchanged invoice never re-grades differently', () => {
    expect(renderInvoice(INVOICE)).toBe(renderInvoice(INVOICE))
  })
})
