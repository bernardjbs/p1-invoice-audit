import { defineConfig } from 'vitest/config'

/**
 * The eval harnesses are not a workspace package, so the workspace fan-out in
 * `bun run test` never reached them and their code was untested by construction.
 * That mattered most for the reply cache: a stale entry there does not surface
 * as a bug, it surfaces as an eval score, which is the hardest kind of wrong to
 * notice.
 *
 * Unit tier only — nothing here may need a database, credentials or a model.
 */
export default defineConfig({
  test: {
    include: ['evals/**/*.test.ts'],
  },
})
