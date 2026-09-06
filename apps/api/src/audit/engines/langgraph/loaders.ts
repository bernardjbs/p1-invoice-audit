import { sql } from '../../../db/client'
import type { ContractRate, PurchaseOrder } from './checks'

/**
 * Everything the deterministic checks compare against, read from Postgres.
 *
 * The split this file exists to enforce: the MODEL reads the invoice, the
 * DATABASE holds the truth it is measured against. Rates, purchase orders and
 * vendor standing are all rows we own, so no model is asked to recall them and
 * none of them can be hallucinated into an audit finding. It is also why the
 * extraction schema deliberately omits the PO number — see extraction.ts.
 *
 * Thin on purpose: one query each, coercion, no rules. Every judgement lives in
 * `checks.ts`, which stays pure and testable without a database.
 */

/**
 * Postgres `numeric` arrives as a STRING through postgres.js — it is arbitrary
 * precision, so the driver refuses to lose digits for us. Coercing at the edge
 * is what lets the checks be plain arithmetic over numbers; miss it once and
 * `unitPrice > rate` becomes a string comparison that is wrong without erroring.
 */
const toNumber = (value: string): number => Number(value)

/**
 * The vendor's agreed rate card, flattened across all of their contracts.
 *
 * Keyed by vendor rather than by contract because that is the question the price
 * check asks ("what did we agree to pay this vendor for this item?"), and an
 * invoice may carry no `contract_id` while the vendor still has a rate card.
 */
export async function loadRates(vendorId: string): Promise<ContractRate[]> {
  const rows = await sql<{ item_code: string; rate_aud: string }[]>`
    select r.item_code, r.rate_aud
    from contract_rates r
    join contracts c on c.id = r.contract_id
    where c.vendor_id = ${vendorId}
    order by r.item_code`

  return rows.map((row) => ({ itemCode: row.item_code, rateAud: toNumber(row.rate_aud) }))
}

/**
 * The purchase order an invoice was raised against, or null if it has none.
 *
 * NULL rather than a zero-dollar placeholder: `invoices.po_id` is nullable, and
 * a synthesised "$0.00 ordered" would reach the UI as an order for nothing
 * instead of the absence of one. `runPoMatchCheck` takes the null and says so.
 *
 * Keyed by INVOICE, not by PO number: the link we trust is the foreign key we
 * set, never a number read off the page — which is also why the PO number is
 * not in the extraction schema.
 */
export async function loadPo(invoiceId: string): Promise<PurchaseOrder | null> {
  const [row] = await sql<{ po_number: string; total_aud: string | null }[]>`
    select po.po_number, po.total_aud
    from invoices i
    join purchase_orders po on po.id = i.po_id
    where i.id = ${invoiceId}`
  if (!row) return null

  // `total_aud` is nullable on the table; an order with no total cannot be
  // matched against, so it is treated the same as no order at all.
  if (row.total_aud === null) return null

  return { poNumber: row.po_number, totalAud: toNumber(row.total_aud) }
}

/** A vendor's identity and standing, as the contract-terms agent needs it. */
export type Vendor = {
  id: string
  name: string
  /** On the approved-supplier list. False is a finding, not an error. */
  isApproved: boolean
}

/** One vendor, or null if the id matches nothing. */
export async function loadVendor(vendorId: string): Promise<Vendor | null> {
  const [row] = await sql<{ id: string; name: string; is_approved: boolean }[]>`
    select id, name, is_approved from vendors where id = ${vendorId}`
  if (!row) return null

  return { id: row.id, name: row.name, isApproved: row.is_approved }
}
