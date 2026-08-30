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

export default defineConfig({
  test: {
    include: ['**/*.integration.test.ts'],
  },
})
