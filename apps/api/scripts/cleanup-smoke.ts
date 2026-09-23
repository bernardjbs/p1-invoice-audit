/**
 * Remove the invoices the post-deploy smoke leaves behind, from the database and
 * from Storage.
 *
 *   doppler run -c prd -- bun run apps/api/scripts/cleanup-smoke.ts            # every SMOKE-* invoice
 *   doppler run -c prd -- bun run apps/api/scripts/cleanup-smoke.ts SMOKE-123  # only the ones named
 *
 * WHY THIS IS NOT A FLAG ON THE SMOKE. The smoke drives the deployed origin over
 * plain HTTP and holds no database credentials, deliberately: it is the one check
 * that exercises the shipped artefact the way a user reaches it. Cleaning up over
 * HTTP would need a delete route on a public API, which is a destructive endpoint
 * on a public app existing only for test tidy-up. Cleanup is an operator job, so
 * it gets an operator script with the credentials and no public surface.
 *
 * The prefix is the safety rail: this only ever matches invoice numbers beginning
 * SMOKE-, so it cannot reach seeded or uploaded data even if given the wrong
 * argument. Child rows (lines, audit runs, review decisions) cascade.
 */
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { poolerSafeOptions } from '../src/db/client'
import { SMOKE_PREFIX, isSmokeInvoiceNumber } from './smoke-invoice'

async function main(): Promise<void> {
  const named = process.argv.slice(2)
  const rejected = named.filter((n) => !isSmokeInvoiceNumber(n))
  if (rejected.length) {
    console.error(`cleanup-smoke: refusing non-smoke invoice number(s): ${rejected.join(', ')}`)
    process.exit(1)
  }

  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('cleanup-smoke: DATABASE_URL must be set (run it through doppler)')
    process.exit(1)
  }
  const sql = postgres(url, poolerSafeOptions(url))
  const like = `${SMOKE_PREFIX}%`

  const doomed = named.length
    ? await sql`select id, invoice_number, pdf_path from invoices
                where invoice_number = any(${named}) and invoice_number like ${like}`
    : await sql`select id, invoice_number, pdf_path from invoices
                where invoice_number like ${like}`

  if (!doomed.length) {
    console.log('cleanup-smoke: nothing to remove')
    await sql.end()
    return
  }

  const deleted = await sql`
    delete from invoices where id = any(${doomed.map((r) => r.id)}) returning invoice_number`
  const names = deleted.map((r) => r.invoice_number).join(', ')
  console.log(`cleanup-smoke: removed ${deleted.length} invoice(s): ${names}`)

  const [left] = await sql`
    select count(*)::int as n from invoices where invoice_number like ${like}`
  console.log(`cleanup-smoke: SMOKE-* remaining: ${left!.n}`)
  await sql.end()

  /** The row is gone; without this the rendered PDF stays in the bucket for ever. */
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error(
      'cleanup-smoke: rows removed, but SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY unset: PDFs left in Storage',
    )
    process.exit(1)
  }
  const paths = doomed.map((r) => r.pdf_path as string).filter(Boolean)
  const { error } = await createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    .storage.from('invoices')
    .remove(paths)
  if (error) {
    console.error(`cleanup-smoke: rows removed, but the Storage delete failed: ${error.message}`)
    process.exit(1)
  }
  console.log(`cleanup-smoke: removed ${paths.length} stored PDF(s)`)
}

if (import.meta.main) {
  await main()
}
