import { describe, expect, it } from 'vitest'
import { isSampleInvoiceNumber, isSeededInvoiceNumber, SAMPLE_PREFIX } from './sample-cleanup'

/**
 * The prefix check is the last thing standing between a scheduled, unattended
 * delete and real invoices, so it is tested on its own rather than only
 * exercised through a database run.
 */
describe('isSampleInvoiceNumber', () => {
  it('accepts a sample invoice', () => {
    expect(isSampleInvoiceNumber(`${SAMPLE_PREFIX}0001`)).toBe(true)
  })

  it('refuses a seeded invoice', () => {
    expect(isSampleInvoiceNumber('INV-0021')).toBe(false)
  })

  it('refuses an invoice the smoke created', () => {
    expect(isSampleInvoiceNumber('SMOKE-1790180193701')).toBe(false)
  })

  it('refuses a number that merely contains the prefix', () => {
    expect(isSampleInvoiceNumber(`REAL-${SAMPLE_PREFIX}1`)).toBe(false)
  })

  it('refuses the bare prefix, which names no sample', () => {
    expect(isSampleInvoiceNumber(SAMPLE_PREFIX)).toBe(false)
  })

  it('refuses the empty string', () => {
    expect(isSampleInvoiceNumber('')).toBe(false)
  })
})

/**
 * The same kind of rail on the reset sweep. It writes rather than deletes, but
 * it writes to whatever it matches, unattended, so what it may match is tested
 * on its own too.
 */
describe('isSeededInvoiceNumber', () => {
  it('accepts a seeded invoice', () => {
    expect(isSeededInvoiceNumber('INV-0001')).toBe(true)
  })

  it('refuses the bare prefix, which names no invoice', () => {
    expect(isSeededInvoiceNumber('INV-0')).toBe(false)
  })

  it('refuses a sample a visitor uploaded', () => {
    expect(isSeededInvoiceNumber('INV-DEMO-1')).toBe(false)
  })

  it('refuses a number that merely contains the prefix', () => {
    expect(isSeededInvoiceNumber('X-INV-0001')).toBe(false)
  })

  it('refuses an invoice the smoke created', () => {
    expect(isSeededInvoiceNumber('INV-SMOKE-1')).toBe(false)
  })
})
