import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'

import { createAuditMcpServer } from './server'

/**
 * The protocol surface: what an MCP client discovers before it calls anything.
 * Unit tier — no database is touched, because listing tools never runs a tool.
 *
 * The server and client are joined by an in-memory transport pair rather than by
 * spawning a process, so the test exercises the real protocol handshake with no
 * subprocess, no stdio and no ports.
 */
async function connectedClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createAuditMcpServer()
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

describe('the audit MCP server', () => {
  it('advertises the three audit tools', async () => {
    const client = await connectedClient()
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_audit_result',
      'list_invoices',
      'run_audit',
    ])
  })

  it('gives every tool an input schema a client can fill in', async () => {
    const client = await connectedClient()
    const { tools } = await client.listTools()

    const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
    expect(byName.list_invoices?.inputSchema.properties).toHaveProperty('status')
    expect(byName.get_audit_result?.inputSchema.properties).toHaveProperty('invoiceId')
    expect(byName.run_audit?.inputSchema.properties).toHaveProperty('invoiceId')

    // invoiceId is required on both tools that take one; status is optional.
    expect(byName.get_audit_result?.inputSchema.required).toContain('invoiceId')
    expect(byName.run_audit?.inputSchema.required).toContain('invoiceId')
    expect(byName.list_invoices?.inputSchema.required ?? []).not.toContain('status')
  })

  it('declares which tools read and which one writes', async () => {
    // The distinction a client shows a human before allowing a call, so it is
    // asserted rather than left to the reader of the source.
    const client = await connectedClient()
    const { tools } = await client.listTools()
    const readOnly = Object.fromEntries(tools.map((t) => [t.name, t.annotations?.readOnlyHint]))
    expect(readOnly).toEqual({
      list_invoices: true,
      get_audit_result: true,
      run_audit: false,
    })
  })
})
