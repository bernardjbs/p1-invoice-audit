import { describe, expect, it } from 'vitest'
import type { ExtractedInvoice } from '../../extraction'
import { AuditResultSchema, CHECK_TYPES, type CheckResult } from '../../types'
import { buildAuditGraph, runAuditGraph, type AuditGraphDeps } from './graph'

/**
 * The supervisor graph, over injected fakes.
 *
 * Every dependency that leaves the process — the vision model, the two SQL
 * loaders, the contract-terms agent — is injected here, so this tier asserts the
 * WIRING and nothing else: that four checks arrive, that the roll-up picks the
 * worst verdict, and that the variance the UI sorts on comes from the price path.
 * Whether each check is correct is already pinned by checks.test.ts and
 * contract-terms-agent.test.ts; whether the model can read a PDF is measured by
 * the oracle gate. This file would pass with a perfect engine and a useless one,
 * which is exactly its remit.
 */

const cleanInvoice: ExtractedInvoice = {
  invoiceNumber: 'INV-0001',
  abn: '11 222 333 444',
  subtotalAud: 2500,
  gstAud: 250,
  totalAud: 2750,
  lines: [
    { itemCode: 'PUMP-01', description: 'Pump', qty: 2, unitPriceAud: 1000, lineTotalAud: 2000 },
    { itemCode: 'VALVE-02', description: 'Valve', qty: 10, unitPriceAud: 50, lineTotalAud: 500 },
  ],
}

const passingContractTerms: CheckResult = {
  type: 'contract_terms',
  verdict: 'pass',
  evidence: { summary: 'No clause forbids these charges.', sourceRef: 'MSA-1 §4' },
}

/** All four checks pass: maths balances, on rate, PO matches, agent says pass. */
function cleanDeps(overrides: Partial<AuditGraphDeps> = {}): AuditGraphDeps {
  return {
    extract: async () => cleanInvoice,
    loadPo: async () => ({ poNumber: 'PO-1000', totalAud: 2750 }),
    loadRates: async () => [
      { itemCode: 'PUMP-01', rateAud: 1000 },
      { itemCode: 'VALVE-02', rateAud: 50 },
    ],
    judgeContractTerms: async () => passingContractTerms,
    ...overrides,
  }
}

const input = { invoiceId: 'inv-1', vendorId: 'vendor-1', pdf: Buffer.from('%PDF-fake') }

describe('audit graph — the result contract', () => {
  it('returns a result that parses against the locked schema', async () => {
    const result = await runAuditGraph(input, cleanDeps())

    expect(() => AuditResultSchema.parse(result)).not.toThrow()
  })

  it('returns exactly four checks, one per type', async () => {
    const result = await runAuditGraph(input, cleanDeps())

    expect(result.checks).toHaveLength(4)
    expect(result.checks.map((c) => c.type).sort()).toEqual([...CHECK_TYPES].sort())
  })

  it('names itself langgraph', async () => {
    expect((await runAuditGraph(input, cleanDeps())).engine).toBe('langgraph')
  })
})

describe('audit graph — the aggregate node', () => {
  it('passes a clean invoice on every check', async () => {
    const result = await runAuditGraph(input, cleanDeps())

    expect(result.overall).toBe('pass')
    expect(result.checks.every((c) => c.verdict === 'pass')).toBe(true)
    expect(result.variancePct).toBe(0)
  })

  it('reports the worst verdict overall — a single fail outranks three passes', async () => {
    const result = await runAuditGraph(
      input,
      cleanDeps({
        judgeContractTerms: async () => ({
          type: 'contract_terms',
          verdict: 'fail',
          evidence: { summary: 'Call-out fee charged without written approval.' },
        }),
      }),
    )

    expect(result.overall).toBe('fail')
  })

  it('reports a flag when nothing fails but something is flagged', async () => {
    const result = await runAuditGraph(
      input,
      cleanDeps({ loadPo: async () => ({ poNumber: 'PO-9999', totalAud: 5000 }) }),
    )

    expect(result.checks.find((c) => c.type === 'po_match')!.verdict).toBe('flag')
    expect(result.overall).toBe('flag')
  })

  it('carries the variance from the worst overcharged line', async () => {
    const result = await runAuditGraph(
      input,
      cleanDeps({ loadRates: async () => [{ itemCode: 'PUMP-01', rateAud: 800 }] }),
    )

    // 1000 billed against an 800 rate = 25% over.
    expect(result.variancePct).toBeCloseTo(0.25, 5)
    expect(result.checks.find((c) => c.type === 'price_vs_contract')!.verdict).toBe('flag')
  })
})

describe('audit graph — structure', () => {
  it('runs the three deterministic checks as their own nodes, not as agent prompts', () => {
    const nodes = Object.keys(buildAuditGraph(cleanDeps()).getGraph().nodes)

    expect(nodes).toEqual(expect.arrayContaining(['math', 'po_match', 'price']))
  })

  it('runs contract_terms as its own node alongside them', () => {
    const nodes = Object.keys(buildAuditGraph(cleanDeps()).getGraph().nodes)

    expect(nodes).toContain('contract_terms')
  })

  it('reads the invoice and loads the reference data before any check runs', () => {
    const nodes = Object.keys(buildAuditGraph(cleanDeps()).getGraph().nodes)

    expect(nodes).toEqual(expect.arrayContaining(['extract', 'load', 'aggregate']))
  })
})

describe('audit graph — determinism on the fake path', () => {
  // Order is part of the result, not an accident of which node finished first:
  // the four checks land in parallel, so without an explicit ordering the UI
  // would reshuffle between runs and byte-comparison below would be vacuous.
  it('returns the checks in the order the contract lists them', async () => {
    const result = await runAuditGraph(input, cleanDeps())

    expect(result.checks.map((c) => c.type)).toEqual([...CHECK_TYPES])
  })

  it('yields byte-identical results for the same input', async () => {
    const first = await runAuditGraph(input, cleanDeps())
    const second = await runAuditGraph(input, cleanDeps())

    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })
})
