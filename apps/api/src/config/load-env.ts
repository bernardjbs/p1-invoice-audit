import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * Side-effect module: load the repo-root `.env.local` into `process.env` before
 * anything reads it. Import it FIRST in every process entry point (index.ts,
 * worker.ts, scripts) — under `bun run` the child's cwd is apps/api, so Bun's
 * implicit .env loading misses the root file. Walks up from this file so it
 * works regardless of cwd. Best-effort: a bare checkout with no .env.local
 * falls through to the well-known local defaults baked into the DB/storage
 * clients. Vitest tiers load env via their config, so this is idempotent there.
 */
let dir = import.meta.dirname
for (let i = 0; i < 6; i++) {
  const candidate = resolve(dir, '.env.local')
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate)
    break
  }
  dir = dirname(dir)
}
