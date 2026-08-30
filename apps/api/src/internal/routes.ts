import { Hono } from 'hono'
import { runWorkerOnce } from '../worker'

/**
 * Internal worker-drain route (plan T14). On Vercel there is no long-running
 * worker process, so in prod a pg_cron + pg_net job POSTs here every ~10s to
 * drain the pgmq queue once (docs/pgmq-spike.md pattern; scheduled by
 * scripts/setup-prod-worker.ts). In dev the `bun run worker` loop does the same
 * job and this endpoint is unused — but it is mounted everywhere so its auth
 * guard is testable.
 *
 * Guarded by a shared secret (`WORKER_SECRET`): unset → 503 (fail closed, never
 * an open drain); wrong/absent header → 403. Mounted under /api by app.ts, so
 * the path is POST /api/internal/drain.
 */
export const internalRoutes = new Hono()

internalRoutes.post('/internal/drain', async (c) => {
  const secret = process.env.WORKER_SECRET
  if (!secret) return c.json({ error: { message: 'worker not configured', code: 'unconfigured' } }, 503)
  if (c.req.header('x-worker-secret') !== secret)
    return c.json({ error: { message: 'forbidden', code: 'forbidden' } }, 403)
  const processed = await runWorkerOnce()
  return c.json({ processed }, 200)
})
