import { Hono } from 'hono'

/**
 * The Hono app. Thin handlers only (CONVENTIONS §5) — real work lives in service
 * functions. Exported separately from the server entry so tests can mount it
 * without opening a socket.
 */
export const app = new Hono()

app.get('/health', (c) => c.json({ ok: true }))

export type AppType = typeof app
