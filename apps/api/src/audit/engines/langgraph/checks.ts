import type { ExtractedInvoice } from '../../extraction'
import type { CheckResult } from '../../types'

/**
 * The three DETERMINISTIC checks. Arithmetic and lookups, no model.
 *
 * These are the checks that have a right answer, so an LLM must never be the one
 * giving it: asking a model whether 4 × $150 is $600 buys nothing and can be
 * wrong. In the graph they are tools the agent calls, not prompts it writes —
 * the model decides WHICH evidence matters, these decide WHAT the numbers say.
 *
 * Pure on purpose: input in, `CheckResult` out, no database, no clock, no
 * network. The data they compare against arrives from `loaders.ts`, which is the
 * only file here that talks to Postgres.
 */

/** Money compares to the cent; tolerate sub-cent float noise. Matches mock.ts. */
const EPS = 0.005

const money = (n: number): string => n.toFixed(2)

/** One purchase order, as `loaders.loadPo` returns it. */
export type PurchaseOrder = {
  poNumber: string
  totalAud: number
}

/** Does the invoice add up: lines → subtotal, and subtotal + GST → total. */
export function runMathCheck(extracted: ExtractedInvoice): CheckResult {
  const linesSum = extracted.lines.reduce((sum, line) => sum + line.lineTotalAud, 0)
  const subtotalOk = Math.abs(linesSum - extracted.subtotalAud) < EPS
  const totalOk = Math.abs(extracted.subtotalAud + extracted.gstAud - extracted.totalAud) < EPS
  const ok = subtotalOk && totalOk

  return {
    type: 'math',
    verdict: ok ? 'pass' : 'fail',
    evidence: {
      summary: ok
        ? 'Line totals sum to the subtotal and subtotal + GST equals the total.'
        : 'Invoice arithmetic does not balance.',
      expected: money(extracted.subtotalAud + extracted.gstAud),
      actual: money(extracted.totalAud),
    },
  }
}

/**
 * Does the invoice bill what was ordered? Total-level only, matching the
 * Phase-A rule: line-level PO reconciliation is a different (harder) check and
 * the PO lines are not what the model reads off the invoice.
 *
 * A mismatch is a FLAG, not a fail — the invoice may be arithmetically perfect
 * and still not be what we asked for, which is a question for a human.
 */
export function runPoMatchCheck(
  extracted: ExtractedInvoice,
  po: PurchaseOrder | null,
): CheckResult {
  // No PO is a real state (`invoices.po_id` is nullable), and it is a finding in
  // its own right: nothing authorised this spend. Left without expected/actual
  // because there is no ordered amount to name — a "0.00 expected" would read as
  // an order for nothing rather than the absence of one.
  if (po === null) {
    return {
      type: 'po_match',
      verdict: 'flag',
      evidence: { summary: 'No purchase order is linked to this invoice.' },
    }
  }

  const ok = Math.abs(extracted.totalAud - po.totalAud) < EPS
  return {
    type: 'po_match',
    verdict: ok ? 'pass' : 'flag',
    evidence: {
      summary: ok
        ? 'Invoice total matches the purchase order total.'
        : 'Invoice total does not match the purchase order total.',
      expected: money(po.totalAud),
      actual: money(extracted.totalAud),
      sourceRef: po.poNumber,
    },
  }
}

/** One rate-card line, as `loaders.loadRates` returns it. */
export type ContractRate = {
  itemCode: string
  rateAud: number
}

type Overage = {
  itemCode: string
  rateAud: number
  unitPriceAud: number
  /** How far over the rate, as a fraction of it. 0.10 = billed 10% high. */
  deviation: number
}

/**
 * The single line that is furthest over its contracted rate, or null if none is.
 *
 * One shared traversal so `runPriceCheck` and `variancePct` can never disagree
 * about which line is worst — they are reported side by side in the UI, and two
 * copies of this loop would drift the moment either rule changed.
 *
 * ONE-SIDED on purpose: only overcharges are findings. A line billed below the
 * rate is money in our favour and never worth a human's time.
 *
 * WHY the comparison is in dollars, not in percent: mock.ts tests the fractional
 * deviation against the same 0.005 constant it uses for money, which silently
 * means "ignore anything under 0.5% of the rate" — at a $250 rate that lets a
 * $1.20 overcharge through on every line. Here the tolerance is the half-cent it
 * was named for, so a rate is matched to the cent whatever its size, and the plan's
 * boundary holds at every rate: exactly on rate passes, one cent over flags.
 */
function worstOverage(extracted: ExtractedInvoice, rates: ContractRate[]): Overage | null {
  const card = new Map(rates.map((rate) => [rate.itemCode, rate.rateAud]))

  let worst: Overage | null = null
  for (const line of extracted.lines) {
    const rateAud = card.get(line.itemCode)
    // No rate card entry, or a nonsense rate: nothing to compare against, and
    // guessing one would manufacture a finding. A zero rate would also divide by
    // zero below. Silence here is the honest answer.
    if (rateAud === undefined || rateAud <= 0) continue

    const over = line.unitPriceAud - rateAud
    if (over <= EPS) continue

    const deviation = over / rateAud
    if (worst === null || deviation > worst.deviation) {
      worst = { itemCode: line.itemCode, rateAud, unitPriceAud: line.unitPriceAud, deviation }
    }
  }
  return worst
}

/**
 * How far the worst overcharged line is over its rate, as a fraction (0.10 =
 * 10% high). Zero when nothing is over.
 *
 * Separate from the check because it is a different KIND of answer: the check
 * says whether a human should look, this feeds `AuditResult.variancePct`, which
 * is a magnitude the UI sorts and thresholds on.
 */
export function variancePct(extracted: ExtractedInvoice, rates: ContractRate[]): number {
  return worstOverage(extracted, rates)?.deviation ?? 0
}

/** Is any line billed above the rate the contract fixed for it? */
export function runPriceCheck(extracted: ExtractedInvoice, rates: ContractRate[]): CheckResult {
  const worst = worstOverage(extracted, rates)

  if (worst === null) {
    return {
      type: 'price_vs_contract',
      verdict: 'pass',
      evidence: { summary: 'Every line is at or below its contracted rate.' },
    }
  }

  return {
    type: 'price_vs_contract',
    verdict: 'flag',
    evidence: {
      summary: `Line ${worst.itemCode} billed above its contracted rate.`,
      expected: money(worst.rateAud),
      actual: money(worst.unitPriceAud),
      sourceRef: worst.itemCode,
    },
  }
}
