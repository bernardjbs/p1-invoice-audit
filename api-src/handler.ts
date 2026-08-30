import { handle } from 'hono/vercel'
import { app } from '../apps/api/src/app'

/**
 * Vercel serverless entry for the Hono API (plan T14), bundled by vercel.json's
 * buildCommand into the co-located api/_handler.js and re-exported by the thin
 * api/[[...route]].ts that Vercel detects.
 *
 * Vercel's Node runtime treats a DEFAULT export as `(req, res) => void` and
 * ignores a returned Response — so `export default handle(app)` hangs (the
 * response never sends). Instead export NAMED HTTP-method handlers: Vercel
 * routes each method to its export, and `handle(app)` is a Web fetch-style
 * `(Request) => Response` for every one. This mirrors Hono's Next.js pattern
 * (`export const GET = handle(app)`). The app already mounts routes under /api
 * and receives the full path, so no basePath change is needed.
 */
const h = handle(app)

export const GET = h
export const POST = h
export const PUT = h
export const PATCH = h
export const DELETE = h
export const OPTIONS = h
export const HEAD = h
