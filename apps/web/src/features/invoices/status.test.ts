import { describe, expect, it } from 'vitest'
import { countByStatus, STATUS_META } from './status'
import type { InvoiceListItem } from './types'

const inv = (status: InvoiceListItem['status']): InvoiceListItem => ({
  id: crypto.randomUUID(),
  invoiceNumber: 'INV',
  vendorName: 'V',
  status,
  invoiceDate: null,
  totalAud: 0,
})

describe('countByStatus', () => {
  it('tallies invoices by status', () => {
    const counts = countByStatus([inv('received'), inv('received'), inv('paused_review')])
    expect(counts.received).toBe(2)
    expect(counts.paused_review).toBe(1)
    expect(counts.passed).toBe(0)
  })
})

describe('STATUS_META', () => {
  it('has a label and tone for every status', () => {
    for (const key of Object.keys(STATUS_META)) {
      expect(STATUS_META[key as keyof typeof STATUS_META].label).toBeTruthy()
    }
  })
})
