import { defineConfig } from '@playwright/test'

/**
 * E2E acceptance suite (plan T13). Runs against the full local stack — API
 * (:3000), web (:5173), and a background audit worker. globalSetup resets+seeds
 * the DB and starts the worker (with the AUDIT_ENGINE under test); the two HTTP
 * servers are managed by webServer below. See e2e/README.md for manual runs.
 *
 * Engine-swap proof (criterion 7): `bun run e2e` runs everything with the mock
 * engine; `bun run e2e:stub` runs only the engine-agnostic specs (@swap) with
 * AUDIT_ENGINE=stub — the all-pass stub can't produce a paused_review, so the
 * verdict-asserting review-flow is mock-only by design (routed from T5).
 */
const CI = !!process.env.CI

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: 0,
  timeout: 30_000,
  reporter: CI ? 'list' : [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'bun run --filter @starter/api dev',
      url: 'http://localhost:3000/health',
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
    {
      command: 'bun run --filter @starter/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
  ],
})
