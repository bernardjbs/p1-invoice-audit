import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Integration tier — runs ONLY *.integration.test.ts, which require the local
 * Postgres (Supabase) to be up and seeded. Invoked explicitly via
 * `bun run test:integration`, never by the default unit-tier `test`.
 *
 * Load the repo-root .env.local (SUPABASE_URL / service-role key / DATABASE_URL)
 * so tests reach the local DB + Storage regardless of cwd or worker inheritance.
 * Best-effort: the DB-backed tests still fall back to the well-known local
 * defaults if the file is absent.
 */
try {
  process.loadEnvFile(resolve(import.meta.dirname, '../../.env.local'))
} catch {
  // no .env.local (e.g. a bare checkout) — tests use built-in local fallbacks.
}

/**
 * This tier must never post to the real Slack channel. Doppler `dev` holds the
 * real webhook, and on 2026-10-14 every test that paused an invoice made the
 * worker send Bernard a real "paused for review" message. Cleared here, in the
 * config body, because it runs in the main process before any worker or test
 * module starts, and workers (and the worker processes tests spawn) inherit this
 * environment. The CI slice imports this file, so it inherits the clearing too.
 * Guarded by `src/notify/slack.integration-env.integration.test.ts`.
 */
delete process.env.SLACK_WEBHOOK_URL

export default defineConfig({
  test: {
    include: ['**/*.integration.test.ts'],
    // One shared local DB → run test files one at a time so no two files touch
    // the DB or queue concurrently (Vitest runs tests within a file serially by
    // default). Deterministic order; the tier is re-runnable without a reset.
    fileParallelism: false,
  },
})
