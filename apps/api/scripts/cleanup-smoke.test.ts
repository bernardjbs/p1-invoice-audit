import { describe, expect, it } from 'vitest'
import { isSmokeInvoiceNumber } from './smoke-invoice'

/**
 * The prefix check is the only thing standing between this script and real
 * invoices, so it is tested on its own rather than only exercised through a
 * database run.
 */
describe('isSmokeInvoiceNumber', () => {
  it('accepts an invoice the smoke created', () => {
    expect(isSmokeInvoiceNumber('SMOKE-1790180193701')).toBe(true)
  })

  it('refuses a seeded invoice', () => {
    expect(isSmokeInvoiceNumber('INV-0021')).toBe(false)
  })

  it('refuses a number that merely contains the prefix', () => {
    expect(isSmokeInvoiceNumber('INV-SMOKE-1')).toBe(false)
  })

  it('refuses the empty string', () => {
    expect(isSmokeInvoiceNumber('')).toBe(false)
  })
})
