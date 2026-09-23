import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { auditInvoice } from '../audit/engine'
import { persistAuditRun } from '../audit/runs'
import { sql } from '../db/client'
import { createAuditMcpServer } from './server'

/**
 * The tools actually running, against the seeded local database. Integration
 * tier: needs Supabase up and seeded.
 *
 * What this proves beyond the unit tier is that the tools reach the real
 * services and hand back parseable JSON — the claim the server exists to make.
 */
async function connectedClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createAuditMcpServer()
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

/** Tool results arrive as text parts; every tool here answers with JSON. */
function jsonFrom(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  const [part] = result.content as { type: string; text: string }[]
  expect(part?.type).toBe('text')
  return JSON.parse(part!.text)
}

let auditedInvoiceId: string
let neverAuditedInvoiceId: string
let createdRunId: string

/**
 * The fixture is made here rather than assumed: a freshly seeded database has
 * invoices but no audit runs, since runs are produced by the worker. The mock
 * engine gives a real, correctly-shaped result for nothing, so the read path is
 * exercised against genuine data without paying a model or requiring that
 * somebody remembered to run the worker first.
 *
 * Building the result by hand here instead would put check vocabulary outside
 * the audit seam, which is exactly what scripts/seam-gate.sh exists to stop.
 */
beforeAll(async () => {
  const [seeded] = await sql<{ id: string }[]>`
    select id from invoices where invoice_number = 'INV-0001'`
  auditedInvoiceId = seeded!.id
  createdRunId = await persistAuditRun(
    auditedInvoiceId,
    await auditInvoice(auditedInvoiceId, { engine: 'mock' }),
  )

  const [fresh] = await sql<{ id: string }[]>`
    select i.id from invoices i
    where not exists (select 1 from audit_runs r where r.invoice_id = i.id) limit 1`
  neverAuditedInvoiceId = fresh!.id
})

/** Leave the database as it was found: the tier is re-runnable without a reset. */
afterAll(async () => {
  await sql`delete from check_results where audit_run_id = ${createdRunId}`
  await sql`delete from audit_runs where id = ${createdRunId}`
})

describe('list_invoices', () => {
  it('returns the seeded invoices', async () => {
    const client = await connectedClient()
    const rows = jsonFrom(await client.callTool({ name: 'list_invoices', arguments: {} })) as {
      id: string
      invoiceNumber: string
      vendorName: string
    }[]

    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]).toHaveProperty('invoiceNumber')
    expect(rows[0]).toHaveProperty('vendorName')
  })

  it('honours the status filter', async () => {
    const client = await connectedClient()
    const all = jsonFrom(await client.callTool({ name: 'list_invoices', arguments: {} })) as {
      status: string
    }[]
    const wanted = all[0]!.status
    const filtered = jsonFrom(
      await client.callTool({ name: 'list_invoices', arguments: { status: wanted } }),
    ) as { status: string }[]

    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.every((row) => row.status === wanted)).toBe(true)
    expect(filtered.length).toBeLessThanOrEqual(all.length)
  })
})

describe('get_audit_result', () => {
  it('returns the audit for an invoice that has one', async () => {
    const client = await connectedClient()
    const run = jsonFrom(
      await client.callTool({
        name: 'get_audit_result',
        arguments: { invoiceId: auditedInvoiceId },
      }),
    ) as { audited: boolean; engine: string; overall: string; checks: unknown[] }

    expect(run.audited).toBe(true)
    expect(typeof run.engine).toBe('string')
    expect(['pass', 'flag', 'fail']).toContain(run.overall)
    expect(run.checks.length).toBeGreaterThan(0)
  })

  it('says so plainly when an invoice has never been audited', async () => {
    const client = await connectedClient()
    const answer = jsonFrom(
      await client.callTool({
        name: 'get_audit_result',
        arguments: { invoiceId: neverAuditedInvoiceId },
      }),
    ) as { audited: boolean; reason: string }

    expect(answer.audited).toBe(false)
    expect(answer.reason).toMatch(/no audit run/i)
  })
})

describe('run_audit', () => {
  it('queues a job and returns the queue message id', async () => {
    const client = await connectedClient()
    const queued = jsonFrom(
      await client.callTool({ name: 'run_audit', arguments: { invoiceId: auditedInvoiceId } }),
    ) as { queued: boolean; queuedMessageId: string }

    expect(queued.queued).toBe(true)
    // A pgmq id is a bigint, so it arrives as a string: asserted deliberately,
    // because this test is what found the queue module claiming `number`.
    expect(typeof queued.queuedMessageId).toBe('string')
    expect(queued.queuedMessageId).toMatch(/^\d+$/)

    // Clean up: the worker is not running in this tier, so the job would sit in
    // the queue and skew a later depth assertion.
    await sql`select pgmq.delete('audit_jobs', ${queued.queuedMessageId}::bigint)`
  })
})
