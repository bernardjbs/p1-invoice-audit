import type { AuditInput, AuditResult, CheckResult, Verdict } from '../types'

/**
 * The Phase-A mock engine. It runs a real (if simplified) four-check audit over
 * the invoice data it is handed — no LLM, no network, fully deterministic, so
 * the e2e suite is stable. Phase B replaces this file's `runMockEngine` with the
 * LangGraph engine behind the same signature; nothing else changes.
 */

// Money compares to the cent; tolerate sub-cent float noise.
const EPS = 0.005

const money = (n: number): string => n.toFixed(2)

/** Overall verdict is the worst individual verdict. */
function rollUp(checks: CheckResult[]): Verdict {
  if (checks.some((c) => c.verdict === 'fail')) return 'fail'
  if (checks.some((c) => c.verdict === 'flag')) return 'flag'
  return 'pass'
}

function mathCheck(input: AuditInput): CheckResult {
  const linesSum = input.lines.reduce((s, l) => s + l.lineTotalAud, 0)
  const subtotalOk = Math.abs(linesSum - input.invoice.subtotalAud) < EPS
  const totalOk = Math.abs(input.invoice.subtotalAud + input.invoice.gstAud - input.invoice.totalAud) < EPS
  const ok = subtotalOk && totalOk
  return {
    type: 'math',
    verdict: ok ? 'pass' : 'fail',
    evidence: {
      summary: ok
        ? 'Line totals sum to the subtotal and subtotal + GST equals the total.'
        : 'Invoice arithmetic does not balance.',
      expected: money(input.invoice.subtotalAud + input.invoice.gstAud),
      actual: money(input.invoice.totalAud),
    },
  }
}

function priceVsContractCheck(input: AuditInput): { check: CheckResult; variancePct: number } {
  const rates = new Map(input.contractRates.map((r) => [r.itemCode, r.rateAud]))
  let worst: { itemCode: string; rate: number; price: number; deviation: number } | null = null
  for (const line of input.lines) {
    const rate = rates.get(line.itemCode)
    if (rate === undefined || rate <= 0) continue
    const deviation = (line.unitPriceAud - rate) / rate
    if (deviation > EPS && (worst === null || deviation > worst.deviation)) {
      worst = { itemCode: line.itemCode, rate, price: line.unitPriceAud, deviation }
    }
  }
  if (worst === null) {
    return {
      check: {
        type: 'price_vs_contract',
        verdict: 'pass',
        evidence: { summary: 'Every line is at or below its contracted rate.' },
      },
      variancePct: 0,
    }
  }
  return {
    check: {
      type: 'price_vs_contract',
      verdict: 'flag',
      evidence: {
        summary: `Line ${worst.itemCode} billed above its contracted rate.`,
        expected: money(worst.rate),
        actual: money(worst.price),
        sourceRef: worst.itemCode,
      },
    },
    variancePct: worst.deviation,
  }
}

function poMatchCheck(input: AuditInput): CheckResult {
  const ok = Math.abs(input.invoice.totalAud - input.po.totalAud) < EPS
  return {
    type: 'po_match',
    verdict: ok ? 'pass' : 'flag',
    evidence: {
      summary: ok
        ? 'Invoice total matches the purchase order total.'
        : 'Invoice total does not match the purchase order total.',
      expected: money(input.po.totalAud),
      actual: money(input.invoice.totalAud),
      sourceRef: input.po.poNumber,
    },
  }
}

function contractTermsCheck(input: AuditInput): CheckResult {
  const ok = input.vendor.isApproved
  return {
    type: 'contract_terms',
    verdict: ok ? 'pass' : 'fail',
    evidence: {
      summary: ok
        ? `Vendor ${input.vendor.name} is on the approved list.`
        : `Vendor ${input.vendor.name} is not approved.`,
    },
  }
}

export function runMockEngine(input: AuditInput): AuditResult {
  const price = priceVsContractCheck(input)
  const checks: CheckResult[] = [
    mathCheck(input),
    price.check,
    poMatchCheck(input),
    contractTermsCheck(input),
  ]
  return {
    engine: 'mock',
    overall: rollUp(checks),
    variancePct: price.variancePct,
    checks,
  }
}
