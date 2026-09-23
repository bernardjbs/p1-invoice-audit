import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { readLatestAuditRun } from '../audit/runs'
import { listInvoices } from '../invoices/service'
import { enqueueAudit } from '../queue/audit-queue'

/**
 * A thin MCP server over the audit engine: three tools, each a wrapper around a
 * function the app already has.
 *
 * Thin is the point, not a shortcut. The server exists to show that the engine
 * has a usable boundary — that any MCP client can drive it, not only this repo's
 * own web UI. Putting audit logic here would weaken exactly that claim, because
 * the rules would then live in two places and could drift. So a tool validates
 * its input, calls the service that owns the behaviour, and returns.
 *
 * `readOnlyHint` is set deliberately rather than left off. Two of these tools
 * read and one writes, and a client shows that distinction to whoever is
 * deciding whether to allow a call. Declaring it is the same classification
 * discipline this repo applies to MCP servers it CONSUMES, applied from the
 * producing side.
 */

const SERVER_NAME = 'p1-invoice-audit'
const SERVER_VERSION = '0.1.0'

type ToolConfig = {
  title: string
  description: string
  /** A Zod raw shape: one schema per argument. */
  inputSchema: Record<string, unknown>
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean }
}

/**
 * Register a tool whose result is JSON, with the argument type declared by US.
 *
 * Why this wrapper exists rather than calling `server.registerTool` directly:
 * the SDK declares its tool types against its OWN copy of Zod 4, and this
 * workspace resolves a different patch of Zod 4. Both are Zod 4 and behave
 * identically at runtime (the specs prove these schemas validate), but the two
 * copies declare Zod's branded internals in separate packages, so TypeScript
 * treats them as unrelated and the SDK's argument inference collapses.
 *
 * This is not something the MCP SDK introduced: the repo already carried several
 * Zod copies pulled in by other dependencies. It surfaces here because this is
 * the first place first-party code hands a Zod schema INTO a library that
 * re-declares Zod's types. Bun `overrides` and `resolutions` were both tried;
 * neither deduplicates the transitive copy.
 *
 * So the untyped hop happens once, here, and every tool below is fully typed on
 * our side of it. Runtime behaviour is unchanged: the SDK still parses incoming
 * arguments with these exact schemas before the handler runs.
 */
function registerJsonTool<Args>(
  server: McpServer,
  name: string,
  config: ToolConfig,
  handler: (args: Args) => Promise<unknown>,
): void {
  const register = server.registerTool.bind(server) as unknown as (
    name: string,
    config: ToolConfig,
    cb: (args: Args) => Promise<{ content: { type: 'text'; text: string }[] }>,
  ) => void

  register(name, config, async (args: Args) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(await handler(args), null, 2) }],
  }))
}

export function createAuditMcpServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })

  registerJsonTool<{ status?: string }>(
    server,
    'list_invoices',
    {
      title: 'List invoices',
      description:
        'List invoices with their vendor, status and total. Optionally filter by status ' +
        '(for example "pending", "flagged", "approved").',
      inputSchema: { status: z.string().optional().describe('Filter to one status.') },
      annotations: { readOnlyHint: true },
    },
    async ({ status }) => listInvoices(status),
  )

  registerJsonTool<{ invoiceId: string }>(
    server,
    'get_audit_result',
    {
      title: 'Get audit result',
      description:
        'Read the latest audit run for one invoice: the engine that ran it, the overall ' +
        'verdict, the variance, and every individual check with its cited contract clause.',
      inputSchema: { invoiceId: z.string().min(1).describe('The invoice id.') },
      annotations: { readOnlyHint: true },
    },
    async ({ invoiceId }) => {
      const run = await readLatestAuditRun(invoiceId)
      // A never-audited invoice is an ordinary answer, not an error: say so in
      // words rather than returning a bare null the client has to interpret.
      return run === null
        ? { invoiceId, audited: false, reason: 'No audit run recorded for this invoice.' }
        : { invoiceId, audited: true, ...run }
    },
  )

  registerJsonTool<{ invoiceId: string }>(
    server,
    'run_audit',
    {
      title: 'Run an audit',
      description:
        'Queue an audit for one invoice. Returns immediately with the queue message id; the ' +
        'audit itself runs in the background worker. Poll get_audit_result for the outcome.',
      inputSchema: { invoiceId: z.string().min(1).describe('The invoice id to audit.') },
      // Not read-only: it enqueues work. Not destructive either — it adds a job
      // and overwrites nothing — and not idempotent, since twice queues twice.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ invoiceId }) => {
      // Deliberately NOT called a run id: no run exists until the worker picks
      // the job up. This is the queue's id for the message.
      const queuedMessageId = await enqueueAudit(invoiceId)
      return { invoiceId, queued: true, queuedMessageId }
    },
  )

  return server
}
