import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * Integrity tests for the generated invoice PDFs (plan T4, criterion 3). Runs
 * against the LOCAL Supabase Postgres + Storage — requires `db reset && bun run
 * seed` first. Excluded from the unit tier (see vitest.integration.config.ts):
 * it needs both the DB and the storage service up.
 *
 * The two claims a swappable PDF pipeline must hold:
 *  1. every invoice row carries a non-null pdf_path (the DB→storage link), and
 *  2. every pdf_path resolves to real bytes in the private `invoices` bucket
 *     whose leading four bytes are the `%PDF` magic header.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const sql = postgres(DATABASE_URL, { max: 1 })

// Service-role client BYPASSES RLS (server-only, per CONVENTIONS §15) — needed
// to read a private bucket in the test harness.
const storage = createClient(SUPABASE_URL, SERVICE_ROLE_KEY ?? '', {
  auth: { persistSession: false },
}).storage.from('invoices')

afterAll(async () => {
  await sql.end()
})

describe('generated invoice PDFs', () => {
  it('every invoice row has a non-null pdf_path', async () => {
    const missing = await sql<{ id: string }[]>`
      select id from invoices where pdf_path is null`
    expect(missing).toHaveLength(0)
  })

  it('every pdf_path resolves to bytes with a %PDF magic header', async () => {
    const rows = await sql<{ id: string; pdf_path: string }[]>`
      select id, pdf_path from invoices where pdf_path is not null order by invoice_number`
    expect(rows.length).toBeGreaterThanOrEqual(20)

    for (const { pdf_path } of rows) {
      const { data, error } = await storage.download(pdf_path)
      expect(error, `download ${pdf_path}`).toBeNull()
      expect(data, `bytes for ${pdf_path}`).not.toBeNull()
      const header = new TextDecoder().decode((await data!.arrayBuffer()).slice(0, 4))
      expect(header, `magic header for ${pdf_path}`).toBe('%PDF')
    }
  })
})
