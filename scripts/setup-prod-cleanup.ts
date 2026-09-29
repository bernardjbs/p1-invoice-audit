import { sql } from '../apps/api/src/db/client'

/**
 * Schedule the sample-invoice cleanup in production.
 *
 * Same wiring as the audit drain (`setup-prod-worker.ts`): Vercel has no
 * long-running process, so Postgres drives it — pg_cron fires and pg_net POSTs
 * the deployed endpoint, which removes sample invoices past their time and the
 * PDFs they stored.
 *
 * Run ONCE after a deploy, against prod, with the pooler DATABASE_URL:
 *   doppler run -c prd -- bun run scripts/setup-prod-cleanup.ts
 * Needs env: DATABASE_URL (prod pooler), APP_URL (deployed https origin, no
 * trailing slash), WORKER_SECRET (same value set in Vercel env).
 *
 * TWO NUMBERS, AND THEY ARE NOT THE SAME NUMBER. This script sets how often the
 * sweep RUNS (CLEANUP_SCHEDULE). How long a sample is spared is set by
 * SAMPLE_TTL_MINUTES in the API's own env, because the upload page counts down
 * to it too and one value must serve both. The worst a visitor waits is the two
 * added together: a sample uploaded a moment after a sweep waits out its life,
 * then waits again for the next sweep to notice.
 *
 * Idempotent — safe to re-run; it unschedules any prior job of the same name.
 */
const APP_URL = process.env.APP_URL
const WORKER_SECRET = process.env.WORKER_SECRET
/** pg_cron syntax. Default: every two hours, on the hour. */
const SCHEDULE = process.env.CLEANUP_SCHEDULE ?? '0 */2 * * *'

if (!APP_URL || !WORKER_SECRET) {
  console.error('setup-prod-cleanup: APP_URL and WORKER_SECRET must be set')
  process.exit(1)
}
if (!/^https:\/\//.test(APP_URL)) {
  console.error(`setup-prod-cleanup: APP_URL must be an https origin, got ${APP_URL}`)
  process.exit(1)
}

const cleanupUrl = `${APP_URL.replace(/\/$/, '')}/api/internal/cleanup-samples`

const command = `select net.http_post(
  url := '${cleanupUrl}',
  headers := jsonb_build_object('x-worker-secret', '${WORKER_SECRET}', 'Content-Type', 'application/json'),
  body := '{}'::jsonb
);`

async function main(): Promise<void> {
  await sql`create extension if not exists pg_net`
  await sql`create extension if not exists pg_cron`

  await sql`select cron.unschedule('sample-cleanup')
            where exists (select 1 from cron.job where jobname = 'sample-cleanup')`

  await sql`select cron.schedule('sample-cleanup', ${SCHEDULE}, ${command})`

  const [job] = await sql<{ jobname: string; schedule: string; active: boolean }[]>`
    select jobname, schedule, active from cron.job where jobname = 'sample-cleanup'`
  console.log('sample cleanup scheduled:', job, '→', cleanupUrl)
  await sql.end()
}

main().catch((err) => {
  console.error('[setup-prod-cleanup] failed', err)
  process.exit(1)
})
