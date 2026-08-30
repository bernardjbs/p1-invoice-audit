import { handle } from 'hono/vercel'
import { app } from '../apps/api/src/app'

/**
 * Vercel serverless entry for the Hono API (plan T14). A single catch-all
 * function serves every `/api/*` route on the SAME origin as the static SPA
 * (apps/web/dist), so the web's relative `/api` fetches work unchanged in prod.
 *
 * Node.js is Vercel's DEFAULT function runtime (CONVENTIONS §29) — no runtime
 * config is needed; adding one would only be to opt INTO Edge. The Hono app
 * already mounts its routes under `/api` (app.ts) and `handle()` passes the full
 * request path through, so no `basePath` change is required.
 *
 * Verified against hono.dev + vercel.com (doc-researcher, 2026-08-30).
 */
export default handle(app)
