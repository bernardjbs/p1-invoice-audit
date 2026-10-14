import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../db/client'
import {
  resetStaleDecisions,
  SAMPLE_PREFIX,
  SAMPLE_TTL_MINUTES,
  sweepExpiredSamples,
} from './sample-cleanup'

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

/**
 * The reset sweep. It writes to invoices that look seeded, so the fixtures sit
 * in a reserved range (`INV-09xx`) the seed never reaches, and the seeded 22 are
 * never touched. The out-of-scope numbers are here to prove the rail holds:
 * a sample upload, a number that merely contains the prefix, and the bare
 * prefix, which the `like` pattern matches and only the re-check refuses.
 */
const FIXTURES = [
  'INV-0901',
  'INV-0902',
  'INV-0903',
  'INV-0904',
  'INV-0905',
  'INV-0906',
  'INV-0907',
  'INV-0908',
  'INV-0',
  'X-INV-0001',
  `${SAMPLE_PREFIX}0901`,
]

type Decision = { decision: 'approved' | 'rejected'; ageMinutes: number }

/** An invoice with one audit run and the given decisions, each at an explicit age. */
async function makeDecided(
  invoiceNumber: string,
  status: string,
  decisions: Decision[],
): Promise<string> {
  const [inv] = await sql<{ id: string }[]>`
    insert into invoices (invoice_number, vendor_id, subtotal_aud, gst_aud, total_aud, status)
    select ${invoiceNumber}, v.id, 100, 10, 110, ${status}
    from vendors v limit 1
    returning id`
  const [run] = await sql<{ id: string }[]>`
    insert into audit_runs (invoice_id, engine, overall)
    values (${inv!.id}, 'mock', 'flag')
    returning id`
  for (const d of decisions) {
    await sql`
      insert into review_decisions (invoice_id, audit_run_id, decision, decided_at)
      values (${inv!.id}, ${run!.id}, ${d.decision}, now() - make_interval(mins => ${d.ageMinutes}))`
  }
  return inv!.id
}

async function statusOf(invoiceNumber: string): Promise<string> {
  const [row] = await sql<{ status: string }[]>`
    select status from invoices where invoice_number = ${invoiceNumber}`
  return row!.status
}

describe('resetStaleDecisions', () => {
  beforeAll(async () => {
    // A crashed earlier run would otherwise collide on the unique number.
    await sql`delete from invoices where invoice_number = any(${FIXTURES})`
  })

  it('returns a seeded invoice approved 16 minutes ago to review, and names it', async () => {
    await makeDecided('INV-0901', 'approved', [{ decision: 'approved', ageMinutes: 16 }])

    const result = await resetStaleDecisions()

    expect(result.reset).toContain('INV-0901')
    expect(await statusOf('INV-0901')).toBe('paused_review')
  })

  it('leaves a seeded invoice approved 14 minutes ago alone', async () => {
    await makeDecided('INV-0902', 'approved', [{ decision: 'approved', ageMinutes: 14 }])

    const result = await resetStaleDecisions()

    expect(result.reset).not.toContain('INV-0902')
    expect(await statusOf('INV-0902')).toBe('approved')
  })

  it('returns a stale rejection to review too', async () => {
    await makeDecided('INV-0908', 'rejected', [{ decision: 'rejected', ageMinutes: 16 }])

    const result = await resetStaleDecisions()

    expect(result.reset).toContain('INV-0908')
    expect(await statusOf('INV-0908')).toBe('paused_review')
  })

  it('judges by the latest decision, not the first', async () => {
    // Approved half an hour ago, then rejected a minute ago: the visitor who
    // rejected it is still looking at it, so it stays rejected.
    await makeDecided('INV-0903', 'rejected', [
      { decision: 'approved', ageMinutes: 30 },
      { decision: 'rejected', ageMinutes: 1 },
    ])

    const result = await resetStaleDecisions()

    expect(result.reset).not.toContain('INV-0903')
    expect(await statusOf('INV-0903')).toBe('rejected')
  })

  it('leaves a sample upload, a number containing the prefix, and the bare prefix alone', async () => {
    const old = [{ decision: 'approved' as const, ageMinutes: 16 }]
    await makeDecided(`${SAMPLE_PREFIX}0901`, 'approved', old)
    await makeDecided('X-INV-0001', 'approved', old)
    await makeDecided('INV-0', 'approved', old)

    const result = await resetStaleDecisions()

    expect(result.reset).not.toContain(`${SAMPLE_PREFIX}0901`)
    expect(result.reset).not.toContain('X-INV-0001')
    expect(result.reset).not.toContain('INV-0')
    expect(await statusOf(`${SAMPLE_PREFIX}0901`)).toBe('approved')
    expect(await statusOf('X-INV-0001')).toBe('approved')
    expect(await statusOf('INV-0')).toBe('approved')
  })

  it('leaves seeded invoices at passed and received alone', async () => {
    // Only an invoice sitting at a decision is reset. These carry old decision
    // rows, but their status says nobody's decision is on show, so there is
    // nothing to put back.
    await makeDecided('INV-0904', 'passed', [{ decision: 'approved', ageMinutes: 16 }])
    await makeDecided('INV-0905', 'received', [{ decision: 'approved', ageMinutes: 16 }])

    const result = await resetStaleDecisions()

    expect(result.reset).not.toContain('INV-0904')
    expect(result.reset).not.toContain('INV-0905')
    expect(await statusOf('INV-0904')).toBe('passed')
    expect(await statusOf('INV-0905')).toBe('received')
  })

  it('keeps the decision and the audit run after a reset', async () => {
    const id = await makeDecided('INV-0906', 'approved', [{ decision: 'approved', ageMinutes: 16 }])
    const count = async () => {
      const [row] = await sql<{ decisions: number; runs: number }[]>`
        select (select count(*)::int from review_decisions where invoice_id = ${id}) as decisions,
               (select count(*)::int from audit_runs where invoice_id = ${id}) as runs`
      return row!
    }
    const before = await count()

    const result = await resetStaleDecisions()

    expect(result.reset).toContain('INV-0906')
    expect(await count()).toEqual(before)
  })

  it('returns nothing and changes no status when nothing qualifies', async () => {
    await makeDecided('INV-0907', 'approved', [{ decision: 'approved', ageMinutes: 1 }])
    const snapshot = () => sql<{ invoice_number: string; status: string }[]>`
      select invoice_number, status from invoices order by invoice_number`
    const before = await snapshot()

    const result = await resetStaleDecisions()

    expect(result).toEqual({ reset: [] })
    expect(await snapshot()).toEqual(before)
  })

  afterAll(async () => {
    await sql`delete from invoices where invoice_number = any(${FIXTURES})`
  })
})
