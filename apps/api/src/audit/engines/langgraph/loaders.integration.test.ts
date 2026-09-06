import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../../../db/client'
import { loadPo, loadRates, loadVendor } from './loaders'

/**
 * The check tools' SQL loaders. Plan: 2026-09-04-p1-phase-b-langgraph-engine, task T5.
 *
 * Integration tier: the behaviour under test IS the SQL, so there is nothing left
 * to test once the database is faked out. Fixtures are inserted and removed by
 * this file — seeded rows are never read, so the specs hold whatever the seed
 * happens to contain, and never written, so a failed run cannot corrupt it.
 */

const NO_SUCH_ID = '00000000-0000-0000-0000-000000000000'

let vendorId: string
let otherVendorId: string
let contractId: string
let orderedInvoiceId: string
let unorderedInvoiceId: string

async function insertVendor(name: string, isApproved: boolean): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into vendors (name, is_approved) values (${name}, ${isApproved}) returning id`
  return row!.id
}

async function insertContract(vendor: string, title: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into contracts (vendor_id, title) values (${vendor}, ${title}) returning id`
  return row!.id
}

async function insertRate(contract: string, itemCode: string, rateAud: string): Promise<void> {
  await sql`
    insert into contract_rates (contract_id, item_code, rate_aud)
    values (${contract}, ${itemCode}, ${rateAud})`
}

async function insertPo(vendor: string, poNumber: string, totalAud: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into purchase_orders (po_number, vendor_id, total_aud)
    values (${poNumber}, ${vendor}, ${totalAud}) returning id`
  return row!.id
}

async function insertInvoice(
  vendor: string,
  invoiceNumber: string,
  poId: string | null,
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into invoices (invoice_number, vendor_id, po_id, total_aud)
    values (${invoiceNumber}, ${vendor}, ${poId}, '1100.00') returning id`
  return row!.id
}

beforeAll(async () => {
  vendorId = await insertVendor('Loader Fixture Vendor', true)
  otherVendorId = await insertVendor('Loader Fixture Other Vendor', false)
  contractId = await insertContract(vendorId, 'Loader Fixture MSA')

  await insertRate(contractId, 'LAB-01', '150.00')
  await insertRate(contractId, 'MAT-02', '200.50')
  // The other vendor's card carries the SAME item code at a different price —
  // the rate that must never be returned for our vendor.
  await insertRate(
    await insertContract(otherVendorId, 'Loader Fixture Other MSA'),
    'LAB-01',
    '999.00',
  )

  const poId = await insertPo(vendorId, 'LOAD-PO-9001', '1100.00')
  orderedInvoiceId = await insertInvoice(vendorId, 'LOAD-INV-1001', poId)
  unorderedInvoiceId = await insertInvoice(vendorId, 'LOAD-INV-1002', null)
})

// Cascades from vendors would reach everything below them, but deleting each
// level explicitly says what this file created and keeps the teardown readable.
afterAll(async () => {
  const vendors = [vendorId, otherVendorId]
  await sql`delete from invoices where vendor_id = any(${vendors})`
  await sql`delete from purchase_orders where vendor_id = any(${vendors})`
  await sql`delete from contracts where vendor_id = any(${vendors})`
  await sql`delete from vendors where id = any(${vendors})`
  await sql.end()
})

describe('loadRates', () => {
  it('returns the vendor’s rate card as numbers, not numeric strings', async () => {
    const rates = await loadRates(vendorId)

    expect(rates).toEqual(
      expect.arrayContaining([
        { itemCode: 'LAB-01', rateAud: 150 },
        { itemCode: 'MAT-02', rateAud: 200.5 },
      ]),
    )
  })

  it('never returns another vendor’s rate for the same item code', async () => {
    const rates = await loadRates(vendorId)

    // A leaked rate here would not error — it would quietly change every price
    // verdict for this vendor, which is why the filter is asserted directly.
    expect(rates.map((rate) => rate.rateAud)).not.toContain(999)
    expect(rates).toHaveLength(2)
  })

  it('returns an empty card for a vendor that does not exist', async () => {
    expect(await loadRates(NO_SUCH_ID)).toEqual([])
  })
})

describe('loadPo', () => {
  it('returns the purchase order behind an invoice, with a numeric total', async () => {
    expect(await loadPo(orderedInvoiceId)).toEqual({ poNumber: 'LOAD-PO-9001', totalAud: 1100 })
  })

  it('returns null for an invoice with no purchase order', async () => {
    // `invoices.po_id` is nullable, so null is the honest answer — the check
    // turns it into a finding rather than the loader inventing a zero-dollar PO.
    expect(await loadPo(unorderedInvoiceId)).toBeNull()
  })

  it('returns null for an invoice that does not exist', async () => {
    expect(await loadPo(NO_SUCH_ID)).toBeNull()
  })
})

describe('loadVendor', () => {
  it('returns the vendor’s name and approval standing', async () => {
    expect(await loadVendor(vendorId)).toEqual({
      id: vendorId,
      name: 'Loader Fixture Vendor',
      isApproved: true,
    })
  })

  it('reports an unapproved vendor as unapproved', async () => {
    expect((await loadVendor(otherVendorId))?.isApproved).toBe(false)
  })

  it('returns null for a vendor that does not exist', async () => {
    expect(await loadVendor(NO_SUCH_ID)).toBeNull()
  })
})
