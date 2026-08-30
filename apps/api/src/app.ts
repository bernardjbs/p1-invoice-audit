import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { internalRoutes } from './internal/routes'
import { invoicesRoutes } from './invoices/routes'
import { reviewRoutes } from './review/routes'
import { vendorsRoutes } from './vendors/routes'

/**
 * The Hono app. Thin handlers only (CONVENTIONS §5) — real work lives in service
 * functions. Domain sub-apps are chained via `.route()` so `AppType` carries the
 * full route surface for a future RPC client (CONVENTIONS §9). Exported
 * separately from the server entry so tests can mount it without a socket.
 */
export const app = new Hono()
  .get('/health', (c) => c.json({ ok: true }))
  .route('/api', invoicesRoutes)
  .route('/api', vendorsRoutes)
  .route('/api', reviewRoutes)
  .route('/api', internalRoutes)

// Central error handler (CONVENTIONS §8): known errors keep their status; the
// rest become a generic 500 with the real error logged server-side only.
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse()
  console.error('[api] unhandled error', err)
  return c.json({ error: { message: 'internal server error', code: 'internal' } }, 500)
})

export type AppType = typeof app
