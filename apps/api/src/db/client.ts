import postgres from 'postgres'

/**
 * The single shared Postgres client for the API and worker. Reads DATABASE_URL
 * from the env (loaded by config/load-env.ts at process start, or by the vitest
 * integration config in tests), falling back to the well-known local Supabase
 * DB. No RLS in v1 — the API is the only reader, so it uses this direct
 * connection (the service_role Supabase client is used only for Storage).
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/**
 * On Vercel (`process.env.VERCEL` is set at build + runtime) the API talks to
 * Supabase through the connection pooler, so it needs pgbouncer-safe options:
 * transaction-mode pooling has no prepared statements (`prepare: false`, required
 * on port 6543 and harmless on the session pooler), and the idle/lifetime caps
 * stop a warm function from pinning a pooler slot. Local dev/tests keep
 * postgres.js defaults so nothing there changes. (T14 — verified against the
 * postgres.js README + Supabase pooler docs.)
 */
const serverless = Boolean(process.env.VERCEL)
export const sql = serverless
  ? postgres(DATABASE_URL, { prepare: false, idle_timeout: 20, max_lifetime: 60 * 30, max: 1 })
  : postgres(DATABASE_URL)
