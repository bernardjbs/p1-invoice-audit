import { describe, expect, it } from 'vitest'
import type { ExtractedInvoice } from '../../extraction'
import type { ContractRate } from './checks'
import { runMathCheck, runPoMatchCheck, runPriceCheck, variancePct } from './checks'

/**
 * The deterministic check tools. Plan: 2026-09-04-p1-phase-b-langgraph-engine, task T5.
 */

/** A clean invoice: lines sum to the subtotal, subtotal + GST equals the total. */
function cleanInvoice(): ExtractedInvoice {
  return {
    invoiceNumber: 'INV-1001',
    abn: '51824753556',
    subtotalAud: 1000,
    gstAud: 100,
    totalAud: 1100,
    lines: [
      {
        itemCode: 'LAB-01',
        description: 'Site labour',
        qty: 4,
        unitPriceAud: 150,
        lineTotalAud: 600,
      },
      {
        itemCode: 'MAT-02',
        description: 'Aggregate',
        qty: 2,
        unitPriceAud: 200,
        lineTotalAud: 400,
      },
    ],
  }
}

describe('runMathCheck', () => {
  it('passes on a clean invoice', () => {
    expect(runMathCheck(cleanInvoice()).verdict).toBe('pass')
  })

  it('fails when the line totals do not sum to the subtotal', () => {
    const dirty = cleanInvoice()
    dirty.lines[0]!.lineTotalAud = 650 // 650 + 400 = 1050, not the stated 1000

    expect(runMathCheck(dirty).verdict).toBe('fail')
  })

  it('fails when subtotal + GST does not equal the total, showing expected and actual', () => {
    const dirty = cleanInvoice()
    dirty.totalAud = 1150

    const result = runMathCheck(dirty)

    expect(result.verdict).toBe('fail')
    expect(result.evidence.expected).toBe('1100.00')
    expect(result.evidence.actual).toBe('1150.00')
  })
})

describe('runPoMatchCheck', () => {
  it('passes when the invoice total matches the purchase order', () => {
    const result = runPoMatchCheck(cleanInvoice(), { poNumber: 'PO-9001', totalAud: 1100 })

    expect(result.type).toBe('po_match')
    expect(result.verdict).toBe('pass')
    expect(result.evidence.sourceRef).toBe('PO-9001')
  })

  it('flags a mismatch with the ordered and billed amounts', () => {
    const result = runPoMatchCheck(cleanInvoice(), { poNumber: 'PO-9001', totalAud: 990 })

    expect(result.verdict).toBe('flag')
    expect(result.evidence.expected).toBe('990.00')
    expect(result.evidence.actual).toBe('1100.00')
  })

  it('flags an invoice with no purchase order at all', () => {
    // `invoices.po_id` is nullable, so this is a real state, not a defensive
    // branch — and an unordered invoice is exactly what a three-way match is for.
    const result = runPoMatchCheck(cleanInvoice(), null)

    expect(result.verdict).toBe('flag')
    expect(result.evidence.expected).toBeUndefined()
  })
})

/** The rate card the clean invoice is billed exactly at. */
function rateCard(): ContractRate[] {
  return [
    { itemCode: 'LAB-01', rateAud: 150 },
    { itemCode: 'MAT-02', rateAud: 200 },
  ]
}

describe('runPriceCheck', () => {
  it('passes when every line is at its contracted rate', () => {
    const result = runPriceCheck(cleanInvoice(), rateCard())

    expect(result.type).toBe('price_vs_contract')
    expect(result.verdict).toBe('pass')
  })

  it('passes when a line is billed BELOW its contracted rate', () => {
    // Undercharging is not a finding — the check is one-sided by design.
    const cheap = cleanInvoice()
    cheap.lines[0]!.unitPriceAud = 120

    expect(runPriceCheck(cheap, rateCard()).verdict).toBe('pass')
  })

  it('flags an overcharge with the contracted and billed unit prices', () => {
    const overcharged = cleanInvoice()
    overcharged.lines[0]!.unitPriceAud = 165

    const result = runPriceCheck(overcharged, rateCard())

    expect(result.verdict).toBe('flag')
    expect(result.evidence.expected).toBe('150.00')
    expect(result.evidence.actual).toBe('165.00')
    expect(result.evidence.sourceRef).toBe('LAB-01')
  })

  it('reports the WORST overage when several lines are over', () => {
    const overcharged = cleanInvoice()
    overcharged.lines[0]!.unitPriceAud = 165 // +10%
    overcharged.lines[1]!.unitPriceAud = 250 // +25% — the worst

    expect(runPriceCheck(overcharged, rateCard()).evidence.sourceRef).toBe('MAT-02')
  })

  it('ignores a line with no contracted rate rather than inventing one', () => {
    const extra = cleanInvoice()
    extra.lines[0]!.itemCode = 'NOT-ON-THE-CARD'

    expect(runPriceCheck(extra, rateCard()).verdict).toBe('pass')
  })

  it('passes at EXACTLY the contracted rate', () => {
    const exact = cleanInvoice()
    exact.lines[1]!.unitPriceAud = 200

    expect(runPriceCheck(exact, rateCard()).verdict).toBe('pass')
  })

  it('flags one cent over the contracted rate', () => {
    const overByACent = cleanInvoice()
    overByACent.lines[1]!.unitPriceAud = 200.01

    expect(runPriceCheck(overByACent, rateCard()).verdict).toBe('flag')
  })
})

describe('variancePct', () => {
  it('is zero when nothing is over its contracted rate', () => {
    expect(variancePct(cleanInvoice(), rateCard())).toBe(0)
  })

  it('is the fractional overage of the worst line', () => {
    const overcharged = cleanInvoice()
    overcharged.lines[0]!.unitPriceAud = 165 // 165 over a 150 rate = 0.10

    expect(variancePct(overcharged, rateCard())).toBeCloseTo(0.1, 10)
  })

  it('agrees with the check: a flagged invoice has a non-zero variance', () => {
    const overByACent = cleanInvoice()
    overByACent.lines[1]!.unitPriceAud = 200.01

    expect(runPriceCheck(overByACent, rateCard()).verdict).toBe('flag')
    expect(variancePct(overByACent, rateCard())).toBeGreaterThan(0)
  })
})
