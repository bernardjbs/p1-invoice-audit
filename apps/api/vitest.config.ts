import { configDefaults, defineConfig } from 'vitest/config'

/**
 * Two test tiers (CONVENTIONS §13/§29):
 *  - default `test` = unit tier, no environment — runs everywhere incl. CI.
 *  - `test:integration` = *.integration.test.ts, needs the local Postgres
 *    (Supabase) up. Excluded from the default run so CI (no DB) stays green.
 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
  },
})
