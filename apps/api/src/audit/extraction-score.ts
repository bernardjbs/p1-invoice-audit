import type { ExtractedInvoice, ExtractedLine } from './extraction'

/**
 * The ORACLE. It compares what the model read off a PDF against what the invoice
 * actually says, and turns the difference into a number the CI gate can act on.
 *
 * It is pure, and it lives in the unit tier, deliberately: the live eval that
 * drives it (`evals/extraction/run.ts`) costs twenty model calls, so the rules of
 * scoring must be provable without spending any.
 *
 * "What the invoice actually says" is free here because the invoices are
 * synthetic — the seed wrote the rows, the PDFs were rendered FROM those rows,
 * and `assets/invoices/ground-truth.json` is derived from the rows again. The
 * model sees only the rendered page, so the answer key was never in its input.
 * That is the whole reason this project can measure its own AI at all.
 */

/** Money compares to the cent, matching the engine's own tolerance. */
const EPS = 0.005

/** The fields the oracle scores — the ones actually printed on the PDF. */
type ScorableLine = Pick<
  ExtractedLine,
  'itemCode' | 'description' | 'qty' | 'unitPriceAud' | 'lineTotalAud'
>
export type ScorableInvoice = Pick<
  ExtractedInvoice,
  'invoiceNumber' | 'abn' | 'subtotalAud' | 'gstAud' | 'totalAud'
> & { lines: ScorableLine[] }

export type FieldComparison = {
  /** Field NAME, which is what the diagnostic table aggregates on. */
  field: string
  /** Which line it came from; absent for invoice-level fields. */
  line?: string
  ok: boolean
  expected: string
  actual: string
}

const MISSING = '(missing)'
const INVENTED = '(not on the invoice)'

/** Whitespace and case are printing artefacts, not reading errors. */
const normalise = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase()

function compareText(field: string, expected: string, actual: string | undefined, line?: string) {
  return {
    field,
    ...(line === undefined ? {} : { line }),
    ok: actual !== undefined && normalise(expected) === normalise(actual),
    expected,
    actual: actual ?? MISSING,
  }
}

function compareNumber(field: string, expected: number, actual: number | undefined, line?: string) {
  return {
    field,
    ...(line === undefined ? {} : { line }),
    ok: actual !== undefined && Math.abs(expected - actual) < EPS,
    expected: String(expected),
    actual: actual === undefined ? MISSING : String(actual),
  }
}

const LINE_FIELDS = ['itemCode', 'description', 'qty', 'unitPriceAud', 'lineTotalAud'] as const

function compareLine(expected: ScorableLine, actual: ScorableLine | undefined): FieldComparison[] {
  const key = expected.itemCode
  return [
    compareText('itemCode', expected.itemCode, actual?.itemCode, key),
    compareText('description', expected.description, actual?.description, key),
    compareNumber('qty', expected.qty, actual?.qty, key),
    compareNumber('unitPriceAud', expected.unitPriceAud, actual?.unitPriceAud, key),
    compareNumber('lineTotalAud', expected.lineTotalAud, actual?.lineTotalAud, key),
  ]
}

/**
 * Every line the model returned that the invoice does not have. Counted as wrong
 * at the same weight as a line it missed — otherwise a model could improve its
 * score by inventing lines, since only omissions would cost it anything.
 */
function invented(line: ScorableLine): FieldComparison[] {
  return LINE_FIELDS.map((field) => ({
    field,
    line: line.itemCode,
    ok: false,
    expected: INVENTED,
    actual: String(line[field]),
  }))
}

/**
 * Compare one extraction against the truth, field by field.
 *
 * Lines are matched by item code rather than by position: a model that returns
 * the right lines in a different order has read the invoice correctly, and
 * positional comparison would mark every one of its fields wrong. Matches are
 * consumed, so a repeated code pairs off one-for-one rather than matching twice.
 */
export function compareInvoice(
  expected: ScorableInvoice,
  actual: ScorableInvoice,
): FieldComparison[] {
  const comparisons: FieldComparison[] = [
    compareText('invoiceNumber', expected.invoiceNumber, actual.invoiceNumber),
    compareText('abn', expected.abn, actual.abn),
    compareNumber('subtotalAud', expected.subtotalAud, actual.subtotalAud),
    compareNumber('gstAud', expected.gstAud, actual.gstAud),
    compareNumber('totalAud', expected.totalAud, actual.totalAud),
  ]

  const unmatched = [...actual.lines]
  for (const expectedLine of expected.lines) {
    const i = unmatched.findIndex((l) => normalise(l.itemCode) === normalise(expectedLine.itemCode))
    const match = i === -1 ? undefined : unmatched.splice(i, 1)[0]
    comparisons.push(...compareLine(expectedLine, match))
  }
  for (const leftover of unmatched) comparisons.push(...invented(leftover))

  return comparisons
}

/**
 * The gate's number: correct comparisons over total, pooled across everything
 * passed in. Micro-averaged, so an invoice with six lines weighs more than one
 * with two — which matches where the reading risk actually is. The per-field
 * table below is the macro view, and the two can disagree; the gate is this one.
 */
export function accuracy(comparisons: FieldComparison[]): number {
  if (comparisons.length === 0) return 0
  return comparisons.filter((c) => c.ok).length / comparisons.length
}

export type FieldAccuracy = { field: string; correct: number; total: number; accuracy: number }

/** Accuracy per field NAME — the diagnostic view that says what to go and fix. */
export function byField(comparisons: FieldComparison[]): FieldAccuracy[] {
  const tally = new Map<string, { correct: number; total: number }>()
  for (const c of comparisons) {
    const row = tally.get(c.field) ?? { correct: 0, total: 0 }
    row.total += 1
    if (c.ok) row.correct += 1
    tally.set(c.field, row)
  }
  return [...tally].map(([field, { correct, total }]) => ({
    field,
    correct,
    total,
    accuracy: correct / total,
  }))
}
