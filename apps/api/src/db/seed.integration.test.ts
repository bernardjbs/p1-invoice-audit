import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * Integrity tests for the synthetic seed (plan T3, criterion 2). Runs against
 * the LOCAL Supabase Postgres — requires `db reset && bun run seed` first.
 * Excluded from the unit tier (see vitest.integration.config.ts).
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const sql = postgres(DATABASE_URL, { max: 1 })

afterAll(async () => {
  await sql.end()
})

/** The real ABN checksum: subtract 1 from the first digit, weight, sum, mod 89. */
function isValidAbn(abn: string): boolean {
  if (!/^\d{11}$/.test(abn)) return false
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
  const digits = abn.split('').map(Number)
  digits[0] = digits[0]! - 1
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i]!, 0)
  return sum % 89 === 0
}

describe('seed volume', () => {
  it('has the expected order of magnitude of rows', async () => {
    const [row] = await sql<{ vendors: number; contracts: number; pos: number; invoices: number }[]>`
      select
        (select count(*) from vendors)::int as vendors,
        (select count(*) from contracts)::int as contracts,
        (select count(*) from purchase_orders)::int as pos,
        (select count(*) from invoices)::int as invoices`
    expect(row!.vendors).toBeGreaterThanOrEqual(6)
    expect(row!.contracts).toBeGreaterThanOrEqual(4)
    expect(row!.pos).toBeGreaterThanOrEqual(8)
    expect(row!.invoices).toBeGreaterThanOrEqual(20)
  })
})

describe('referential integrity', () => {
  it('every invoice resolves its vendor, and its PO/contract when set', async () => {
    const orphans = await sql`
      select i.id
      from invoices i
      left join vendors v on v.id = i.vendor_id
      left join purchase_orders po on po.id = i.po_id
      left join contracts c on c.id = i.contract_id
      where v.id is null
         or (i.po_id is not null and po.id is null)
         or (i.contract_id is not null and c.id is null)`
    expect(orphans).toHaveLength(0)
  })

  it('every invoice line resolves its invoice', async () => {
    const orphans = await sql`
      select il.id from invoice_lines il
      left join invoices i on i.id = il.invoice_id
      where i.id is null`
    expect(orphans).toHaveLength(0)
  })
})

describe('data validity', () => {
  it('every vendor ABN passes the real ABN checksum', async () => {
    const rows = await sql<{ abn: string | null }[]>`select abn from vendors`
    for (const { abn } of rows) {
      expect(abn, `ABN present`).not.toBeNull()
      expect(isValidAbn(abn!), `ABN ${abn} valid`).toBe(true)
    }
  })

  it('every invoice header balances: subtotal + gst = total', async () => {
    const bad = await sql`
      select id, subtotal_aud, gst_aud, total_aud from invoices
      where abs((subtotal_aud + gst_aud) - total_aud) > 0.005`
    expect(bad).toHaveLength(0)
  })

  it('every seeded invoice starts in status received', async () => {
    const rows = await sql<{ status: string }[]>`select distinct status from invoices`
    expect(rows.map((r) => r.status)).toEqual(['received'])
  })
})

describe('discrepancy fixtures the audit engine must catch', () => {
  // A line priced above its contract rate, per invoice: the max deviation.
  const overContractQuery = sql`
    select i.id,
           max((il.unit_price_aud - cr.rate_aud) / cr.rate_aud) as max_dev
    from invoices i
    join invoice_lines il on il.invoice_id = i.id
    join contract_rates cr on cr.contract_id = i.contract_id and cr.item_code = il.item_code
    group by i.id`

  it('has at least two invoices exceeding the 5% variance threshold', async () => {
    const rows = await overContractQuery
    const exceeding = rows.filter((r) => Number(r.max_dev) > 0.05)
    expect(exceeding.length).toBeGreaterThanOrEqual(2)
  })

  it('has at least one invoice whose lines do not sum to its subtotal (a maths error)', async () => {
    const rows = await sql`
      select i.id, i.subtotal_aud, sum(il.line_total_aud) as lines_sum
      from invoices i
      join invoice_lines il on il.invoice_id = i.id
      group by i.id, i.subtotal_aud
      having abs(sum(il.line_total_aud) - i.subtotal_aud) > 0.005`
    expect(rows.length).toBeGreaterThanOrEqual(1)
  })

  it('has at least one invoice whose total does not match its PO total', async () => {
    const rows = await sql`
      select i.id from invoices i
      join purchase_orders po on po.id = i.po_id
      where abs(i.total_aud - po.total_aud) > 0.005`
    expect(rows.length).toBeGreaterThanOrEqual(1)
  })

  it('has at least one invoice from an unapproved vendor', async () => {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from invoices i
      join vendors v on v.id = i.vendor_id
      where v.is_approved = false`
    expect(row!.n).toBeGreaterThanOrEqual(1)
  })
})
