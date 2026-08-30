import { defineConfig } from 'vitest/config'

/**
 * Integration tier — runs ONLY *.integration.test.ts, which require the local
 * Postgres (Supabase) to be up and seeded. Invoked explicitly via
 * `bun run test:integration`, never by the default unit-tier `test`.
 */
export default defineConfig({
  test: {
    include: ['**/*.integration.test.ts'],
  },
})
