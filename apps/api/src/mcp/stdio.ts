import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { createAuditMcpServer } from './server'

/**
 * The executable entry point: serve the audit tools over stdio, which is how a
 * local MCP client (Claude Code among them) launches a server — as a child
 * process, speaking the protocol over stdin and stdout.
 *
 * NOTHING may be written to stdout here except protocol messages. A stray
 * console.log corrupts the stream and the client sees a parse error rather than a
 * message from your code. Diagnostics go to stderr.
 *
 * Run it with the database env injected:
 *   doppler run -c dev -- bun run apps/api/src/mcp/stdio.ts
 */
const server = createAuditMcpServer()
await server.connect(new StdioServerTransport())
