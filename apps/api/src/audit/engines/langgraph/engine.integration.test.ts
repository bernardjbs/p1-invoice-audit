import { describe, expect, it } from 'vitest'
import { sql } from '../../../db/client'
import { auditInvoice } from '../../engine'
import { AuditResultSchema, CHECK_TYPES } from '../../types'

/**
 * The real engine, end to end, on a seeded invoice.
 *
 * The unit tier runs the same graph with every outside dependency faked, so it
 * proves the wiring and nothing else. This proves the parts the fakes stand in
 * for actually exist and fit: the PDF is really in storage, the vision model
 * really reads it, the SQL loaders really return rows, retrieval really finds
 * clauses, and the four results really compose into the locked shape.
 *
 * Deliberately does NOT assert verdicts. A live model's answer is not a fixed
 * value, and pinning one here would make this suite flake on a model update
 * rather than on a defect. How WELL it judges is measured by the eval gates.
 */

const CLEAN_INVOICE = 'INV-0001'

describe('langgraph engine (live)', () => {
  it('audits a seeded invoice into the locked result shape', async () => {
    const [row] = await sql<{ id: string }[]>`
      select id from invoices where invoice_number = ${CLEAN_INVOICE}`
    expect(row, `${CLEAN_INVOICE} is not seeded — run \`bun run seed\``).toBeDefined()

    const result = await auditInvoice(row!.id, { engine: 'langgraph' })

    expect(() => AuditResultSchema.parse(result)).not.toThrow()
    expect(result.engine).toBe('langgraph')
    expect(result.checks.map((c) => c.type)).toEqual([...CHECK_TYPES])
    // Every check reached a real verdict — no placeholder or empty evidence.
    for (const check of result.checks) {
      expect(check.evidence.summary.length).toBeGreaterThan(0)
    }
  }, 120_000)
})
