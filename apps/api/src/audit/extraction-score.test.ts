import { describe, expect, it } from 'vitest'
import { accuracy, byField, compareInvoice } from './extraction-score'

/**
 * The oracle's own tests. The scorer decides whether the model passes, so a bug
 * here is worse than a bug in the extractor: a scorer that is too kind reports a
 * healthy number for a model that is misreading invoices, and nothing downstream
 * would ever contradict it.
 */

const TRUTH = {
  invoiceNumber: 'INV-0001',
  abn: '51000000680',
  subtotalAud: 6000,
  gstAud: 600,
  totalAud: 6600,
  lines: [
    {
      itemCode: 'PUMP-100',
      description: 'Centrifugal slurry pump',
      qty: 1,
      unitPriceAud: 5000,
      lineTotalAud: 5000,
    },
    {
      itemCode: 'VALVE-050',
      description: 'Ball valve DN50',
      qty: 4,
      unitPriceAud: 250,
      lineTotalAud: 1000,
    },
  ],
}

/** A deep copy, so a test that edits its input cannot leak into the next one. */
const perfect = (): typeof TRUTH => structuredClone(TRUTH)

describe('compareInvoice', () => {
  it('scores a perfect extraction 1.0', () => {
    expect(accuracy(compareInvoice(TRUTH, perfect()))).toBe(1)
  })

  it('scores an extraction with a wrong total below 1.0', () => {
    const wrong = { ...perfect(), totalAud: 6000 }

    const score = accuracy(compareInvoice(TRUTH, wrong))

    expect(score).toBeLessThan(1)
    expect(byField(compareInvoice(TRUTH, wrong)).find((f) => f.field === 'totalAud')?.correct).toBe(
      0,
    )
  })

  it('scores lines returned in a different order 1.0, because they are matched by item code', () => {
    const reordered = { ...perfect(), lines: [...perfect().lines].reverse() }

    expect(accuracy(compareInvoice(TRUTH, reordered))).toBe(1)
  })

  it('charges a missed line all five of its fields', () => {
    const dropped = { ...perfect(), lines: [perfect().lines[0]!] }

    const comparisons = compareInvoice(TRUTH, dropped)
    const missed = comparisons.filter((c) => c.line === 'VALVE-050')

    expect(missed).toHaveLength(5)
    expect(missed.every((c) => !c.ok)).toBe(true)
  })

  it('charges an invented line as much as a missed one, so padding cannot raise the score', () => {
    const padded = perfect()
    padded.lines.push({
      itemCode: 'GHOST-001',
      description: 'Line the invoice does not have',
      qty: 1,
      unitPriceAud: 99,
      lineTotalAud: 99,
    })

    const comparisons = compareInvoice(TRUTH, padded)

    expect(accuracy(comparisons)).toBeLessThan(1)
    expect(comparisons.filter((c) => c.line === 'GHOST-001')).toHaveLength(5)
  })

  it('accepts money within a cent and rejects a cent out', () => {
    const rounding = { ...perfect(), totalAud: 6600.001 }
    const aCentOut = { ...perfect(), totalAud: 6600.01 }

    expect(accuracy(compareInvoice(TRUTH, rounding))).toBe(1)
    expect(accuracy(compareInvoice(TRUTH, aCentOut))).toBeLessThan(1)
  })

  it('forgives whitespace and case in text, which are printing artefacts not misreadings', () => {
    const spaced = perfect()
    spaced.lines[0]!.description = '  Centrifugal   SLURRY pump '

    expect(accuracy(compareInvoice(TRUTH, spaced))).toBe(1)
  })
})
