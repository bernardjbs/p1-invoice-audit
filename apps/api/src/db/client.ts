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

export const sql = postgres(DATABASE_URL)
