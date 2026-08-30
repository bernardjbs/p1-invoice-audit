import { sql } from '../apps/api/src/db/client'

/**
 * Provision the prod audit worker (plan T14). On Vercel there is no long-running
 * worker, so Postgres drives it: pg_cron fires every 10s and pg_net POSTs the
 * deployed drain endpoint, which runs one `runWorkerOnce()` (docs/pgmq-spike.md).
 *
 * Run ONCE after the first deploy, against prod, with the pooler DATABASE_URL:
 *   doppler run -c prd -- bun run scripts/setup-prod-worker.ts
 * Needs env: DATABASE_URL (prod pooler), APP_URL (deployed https origin, no
 * trailing slash), WORKER_SECRET (same value set in Vercel env).
 *
 * Idempotent — safe to re-run; it unschedules any prior job of the same name.
 */
const APP_URL = process.env.APP_URL
const WORKER_SECRET = process.env.WORKER_SECRET

if (!APP_URL || !WORKER_SECRET) {
  console.error('setup-prod-worker: APP_URL and WORKER_SECRET must be set')
  process.exit(1)
}
if (!/^https:\/\//.test(APP_URL)) {
  console.error(`setup-prod-worker: APP_URL must be an https origin, got ${APP_URL}`)
  process.exit(1)
}

const drainUrl = `${APP_URL.replace(/\/$/, '')}/api/internal/drain`

// The scheduled command: values are ours (not user input), so baking them into
// the job body is safe here. WORKER_SECRET is a generated opaque token.
const command = `select net.http_post(
  url := '${drainUrl}',
  headers := jsonb_build_object('x-worker-secret', '${WORKER_SECRET}', 'Content-Type', 'application/json'),
  body := '{}'::jsonb
);`

async function main(): Promise<void> {
  // pg_net (outbound HTTP) + pg_cron (scheduler). On Supabase these live in the
  // `extensions` schema; `create extension if not exists` is idempotent.
  await sql`create extension if not exists pg_net`
  await sql`create extension if not exists pg_cron`

  await sql`select cron.unschedule('audit-drain')
            where exists (select 1 from cron.job where jobname = 'audit-drain')`

  await sql`select cron.schedule('audit-drain', '10 seconds', ${command})`

  const [job] = await sql<{ jobname: string; schedule: string; active: boolean }[]>`
    select jobname, schedule, active from cron.job where jobname = 'audit-drain'`
  console.log('prod worker scheduled:', job, '→', drainUrl)
  await sql.end()
}

main().catch((err) => {
  console.error('[setup-prod-worker] failed', err)
  process.exit(1)
})
