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
 * Any Supabase connection-pooler URL (transaction mode, port 6543) forbids
 * prepared statements, so `prepare: false` is required whenever we talk to the
 * pooler — that's the deployed function (`process.env.VERCEL` set) AND any local
 * admin run against prod (seed, prod-worker setup) whose DATABASE_URL points at
 * the pooler host. On Vercel we also cap idle/lifetime and `max: 1` so a warm
 * function never pins a pooler slot. Local dev/tests use the direct DB
 * (127.0.0.1) and keep postgres.js defaults, so nothing there changes. (T14 —
 * verified against the postgres.js README + Supabase pooler docs.)
 */
const isPooler = DATABASE_URL.includes('pooler.supabase.com')
const options = process.env.VERCEL
  ? { prepare: false, idle_timeout: 20, max_lifetime: 60 * 30, max: 1 }
  : isPooler
    ? { prepare: false }
    : {}
export const sql = postgres(DATABASE_URL, options)
