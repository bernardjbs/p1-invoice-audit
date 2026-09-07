import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { auditInvoice, runEngine } from './engine'
import type { AuditGraphDeps, AuditGraphInput } from './engines/langgraph'
import type { ExtractedInvoice } from './extraction'
import {
  AuditResultSchema,
  CHECK_TYPES,
  type AuditInput,
  type AuditResult,
  type EngineName,
} from './types'

/**
 * Contract test for the audit seam (criterion 6). It pins the LOCKED shape of an
 * AuditResult and proves EVERY engine satisfies it — the Phase-A mock, the
 * swap-proof stub, and the real LangGraph engine.
 *
 * The three shape assertions below are the point of the whole seam: they are the
 * same assertions, unchanged, run over an engine that did not exist when they
 * were written. No database and no credentials — the mock and stub are pure over
 * an injected bundle, and the LangGraph engine takes its loader and its model,
 * database and agent as injected parts.
 */

// A clean invoice: maths balances, every line at contract rate, PO total
// matches, vendor approved → nothing to flag.
const cleanInput: AuditInput = {
  invoice: {
    id: 'inv-clean',
    invoiceNumber: 'INV-0001',
    subtotalAud: 2500,
    gstAud: 250,
    totalAud: 2750,
  },
  lines: [
    { itemCode: 'PUMP-01', description: 'Pump', qty: 2, unitPriceAud: 1000, lineTotalAud: 2000 },
    { itemCode: 'VALVE-02', description: 'Valve', qty: 10, unitPriceAud: 50, lineTotalAud: 500 },
  ],
  contractRates: [
    { itemCode: 'PUMP-01', rateAud: 1000 },
    { itemCode: 'VALVE-02', rateAud: 50 },
  ],
  po: { poNumber: 'PO-1000', totalAud: 2750 },
  vendor: { name: 'Acme Pumps', isApproved: true },
}

// A single line billed 20% above its contract rate → price_vs_contract flag.
const priceOverInput: AuditInput = {
  invoice: {
    id: 'inv-price',
    invoiceNumber: 'INV-0002',
    subtotalAud: 1200,
    gstAud: 120,
    totalAud: 1320,
  },
  lines: [
    { itemCode: 'PUMP-01', description: 'Pump', qty: 1, unitPriceAud: 1200, lineTotalAud: 1200 },
  ],
  contractRates: [{ itemCode: 'PUMP-01', rateAud: 1000 }],
  po: { poNumber: 'PO-2000', totalAud: 1320 },
  vendor: { name: 'Acme Pumps', isApproved: true },
}

// Vendor not on the approved list → contract_terms fail (a hard fail, not a flag).
const unapprovedVendorInput: AuditInput = {
  ...cleanInput,
  invoice: { ...cleanInput.invoice, id: 'inv-unapproved', invoiceNumber: 'INV-0003' },
  vendor: { name: 'Dodgy Supplies', isApproved: false },
}

// subtotal + gst ≠ total → maths fail.
const mathErrorInput: AuditInput = {
  ...cleanInput,
  invoice: { ...cleanInput.invoice, id: 'inv-math', invoiceNumber: 'INV-0004', totalAud: 9999 },
}

// Invoice total ≠ PO total → po_match flag.
const poMismatchInput: AuditInput = {
  ...cleanInput,
  invoice: { ...cleanInput.invoice, id: 'inv-po', invoiceNumber: 'INV-0005' },
  po: { poNumber: 'PO-9999', totalAud: 5000 },
}

// The same clean invoice as `cleanInput`, but as the LangGraph engine meets it:
// read off the PDF rather than handed over pre-structured.
const cleanExtracted: ExtractedInvoice = {
  invoiceNumber: 'INV-0001',
  abn: '11 222 333 444',
  subtotalAud: 2500,
  gstAud: 250,
  totalAud: 2750,
  lines: cleanInput.lines,
}

const graphLoader = async (invoiceId: string): Promise<AuditGraphInput> => ({
  invoiceId,
  vendorId: 'vendor-1',
  pdf: Buffer.from('%PDF-fake'),
})

const graphDeps: Partial<AuditGraphDeps> = {
  extract: async () => cleanExtracted,
  loadPo: async () => ({ poNumber: 'PO-1000', totalAud: 2750 }),
  loadRates: async () => cleanInput.contractRates,
  judgeContractTerms: async () => ({
    type: 'contract_terms',
    verdict: 'pass',
    evidence: { summary: 'No clause forbids these charges.' },
  }),
}

const ENGINES: { engine: EngineName; run: () => Promise<AuditResult> }[] = [
  { engine: 'mock', run: async () => runEngine(cleanInput, 'mock') },
  { engine: 'stub', run: async () => runEngine(cleanInput, 'stub') },
  {
    engine: 'langgraph',
    run: () => auditInvoice('inv-clean', { engine: 'langgraph', graphLoader, graphDeps }),
  },
]

describe('AuditResult shape contract', () => {
  it.each(ENGINES)('$engine engine output parses against the locked schema', async ({ run }) => {
    const result = await run()
    expect(() => AuditResultSchema.parse(result)).not.toThrow()
  })

  it.each(ENGINES)('$engine engine returns exactly four checks, one per type', async ({ run }) => {
    const result = await run()
    expect(result.checks).toHaveLength(4)
    expect(result.checks.map((c) => c.type).sort()).toEqual([...CHECK_TYPES].sort())
  })

  it.each(ENGINES)('$engine engine names itself in the result', async ({ engine, run }) => {
    expect((await run()).engine).toBe(engine)
  })
})

describe('the langgraph engine is fed differently, and says so', () => {
  it('refuses the pre-structured bundle rather than auditing an empty document', () => {
    expect(() => runEngine(cleanInput, 'langgraph')).toThrow(/not fed AuditInput/)
  })
})

describe('mock engine verdicts', () => {
  it('passes a clean invoice on every check', () => {
    const r = runEngine(cleanInput, 'mock')
    expect(r.overall).toBe('pass')
    expect(r.checks.every((c) => c.verdict === 'pass')).toBe(true)
    expect(r.variancePct).toBe(0)
  })

  it('flags a line billed above its contract rate, with expected/actual evidence', () => {
    const r = runEngine(priceOverInput, 'mock')
    const price = r.checks.find((c) => c.type === 'price_vs_contract')!
    expect(price.verdict).toBe('flag')
    expect(price.evidence.expected).toBe('1000.00')
    expect(price.evidence.actual).toBe('1200.00')
    expect(r.overall).toBe('flag')
    expect(r.variancePct).toBeCloseTo(0.2, 5)
  })

  it('fails an unapproved vendor on contract_terms and overall', () => {
    const r = runEngine(unapprovedVendorInput, 'mock')
    expect(r.checks.find((c) => c.type === 'contract_terms')!.verdict).toBe('fail')
    expect(r.overall).toBe('fail')
  })

  it('fails maths when subtotal + gst does not equal total', () => {
    const r = runEngine(mathErrorInput, 'mock')
    expect(r.checks.find((c) => c.type === 'math')!.verdict).toBe('fail')
    expect(r.overall).toBe('fail')
  })

  it('flags a PO total mismatch', () => {
    const r = runEngine(poMismatchInput, 'mock')
    expect(r.checks.find((c) => c.type === 'po_match')!.verdict).toBe('flag')
  })

  it('is deterministic — same input yields byte-identical results', () => {
    expect(JSON.stringify(runEngine(priceOverInput, 'mock'))).toBe(
      JSON.stringify(runEngine(priceOverInput, 'mock')),
    )
  })
})

describe('stub engine', () => {
  it('passes everything regardless of input (proves the seam seals)', () => {
    const r = runEngine(unapprovedVendorInput, 'stub')
    expect(r.overall).toBe('pass')
    expect(r.checks.every((c) => c.verdict === 'pass')).toBe(true)
  })
})

describe('auditInvoice — the single entry point', () => {
  it('loads by id then dispatches to the named engine', async () => {
    const loader = async (): Promise<AuditInput> => cleanInput
    const r = await auditInvoice('inv-clean', { loader, engine: 'stub' })
    expect(r.engine).toBe('stub')
    expect(AuditResultSchema.parse(r)).toBeTruthy()
  })

  it('defaults to the mock engine', async () => {
    const loader = async (): Promise<AuditInput> => priceOverInput
    const r = await auditInvoice('inv-price', { loader })
    expect(r.engine).toBe('mock')
    expect(r.overall).toBe('flag')
  })
})

// A guard on the schema itself: a result missing a check must not parse.
describe('schema rejects malformed results', () => {
  it('rejects fewer than four checks', () => {
    const bad = { engine: 'mock', overall: 'pass', variancePct: 0, checks: [] }
    expect(() => AuditResultSchema.parse(bad)).toThrow(z.ZodError)
  })
})
