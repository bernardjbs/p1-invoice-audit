import { execSync, spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/**
 * Reset+seed the local DB and start the audit worker before the suite runs.
 * The worker is portless (not a webServer), so it lives here; it inherits
 * AUDIT_ENGINE from the invoking script (mock by default, `stub` for the swap
 * proof). Returns a teardown that stops the worker.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export default function globalSetup(): () => void {
  console.log('[e2e] resetting + seeding local DB…')
  execSync('bunx supabase db reset', { cwd: repoRoot, stdio: 'inherit' })
  execSync('bun run seed', { cwd: repoRoot, stdio: 'inherit' })

  const engine = process.env.AUDIT_ENGINE ?? 'mock'
  console.log(`[e2e] starting audit worker (AUDIT_ENGINE=${engine})…`)
  const worker: ChildProcess = spawn('bun', ['run', '--filter', '@starter/api', 'worker'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, AUDIT_ENGINE: engine, WORKER_POLL_MS: '1000' },
  })

  return () => {
    console.log('[e2e] stopping audit worker…')
    worker.kill('SIGTERM')
  }
}
