import { afterAll, describe, expect, it } from 'vitest'
import { sql } from '../db/client'
import { SAMPLE_PREFIX, SAMPLE_TTL_MINUTES, sweepExpiredSamples } from './sample-cleanup'

/**
 * The scheduled sample cleanup. Integration tier: needs the local Supabase up
 * and seeded.
 *
 * What is being guarded is a DELETE that runs unattended in production, so the
 * test asserts both directions. Deleting too little is litter; deleting too
 * much is somebody's data, and the seeded rows are here to prove it cannot
 * reach them.
 */
async function makeSample(suffix: string, ageMinutes: number): Promise<string> {
  const [row] = await sql<{ invoice_number: string }[]>`
    insert into invoices (invoice_number, vendor_id, subtotal_aud, gst_aud, total_aud, status, created_at)
    select ${`${SAMPLE_PREFIX}${suffix}`}, v.id, 100, 10, 110, 'received',
           now() - make_interval(mins => ${ageMinutes})
    from vendors v limit 1
    returning invoice_number`
  return row!.invoice_number
}

describe('sweepExpiredSamples', () => {
  it('removes samples past their time and leaves fresh ones, seeded rows and other uploads alone', async () => {
    const stale = await makeSample(`STALE-${Date.now()}`, SAMPLE_TTL_MINUTES + 10)
    const fresh = await makeSample(`FRESH-${Date.now()}`, 1)

    // A non-sample upload, to prove the prefix is what bounds the delete rather
    // than "anything that was uploaded".
    const [other] = await sql<{ invoice_number: string }[]>`
      insert into invoices (invoice_number, vendor_id, subtotal_aud, gst_aud, total_aud, status, created_at)
      select ${`UP-KEEP-${Date.now()}`}, v.id, 100, 10, 110, 'received', now() - interval '30 days'
      from vendors v limit 1
      returning invoice_number`

    const seededBefore = await sql<{ n: number }[]>`
      select count(*)::int as n from invoices where invoice_number like 'INV-0%'`

    const result = await sweepExpiredSamples()

    expect(result.removed).toContain(stale)
    expect(result.removed).not.toContain(fresh)

    const survivors = await sql<{ invoice_number: string }[]>`
      select invoice_number from invoices
      where invoice_number in (${stale}, ${fresh}, ${other!.invoice_number})`
    const names = survivors.map((r) => r.invoice_number)
    expect(names).not.toContain(stale)
    expect(names).toContain(fresh)
    // Thirty days old, and untouched, because it is not a sample.
    expect(names).toContain(other!.invoice_number)

    const seededAfter = await sql<{ n: number }[]>`
      select count(*)::int as n from invoices where invoice_number like 'INV-0%'`
    expect(seededAfter[0]!.n).toBe(seededBefore[0]!.n)
  })
})

afterAll(async () => {
  await sql`delete from invoices where invoice_number like ${`${SAMPLE_PREFIX}%`}`
  await sql`delete from invoices where invoice_number like 'UP-KEEP-%'`
})
