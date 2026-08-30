import { beforeAll, describe, expect, it } from 'vitest'
import { app } from '../app'
import { sql } from '../db/client'
import { loadAuditInput } from '../audit/data'

/**
 * API read + upload endpoints (plan T6) + the audit DB loader. Integration tier:
 * runs against the local Supabase (Postgres + Storage), which must be up and
 * seeded (`bunx supabase db reset && bun run seed`). Env is loaded by
 * vitest.integration.config.ts.
 */

// A tiny valid PDF (header + minimal body) for the upload test.
const TINY_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])

let seededInvoiceId: string
let unapprovedInvoiceId: string

beforeAll(async () => {
  const [clean] = await sql<{ id: string }[]>`
    select id from invoices where invoice_number = 'INV-0001'`
  seededInvoiceId = clean!.id
  const [unapproved] = await sql<{ id: string }[]>`
    select i.id from invoices i join vendors v on v.id = i.vendor_id
    where v.is_approved = false limit 1`
  unapprovedInvoiceId = unapproved!.id
})

describe('GET /api/vendors', () => {
  it('returns the seeded vendors with camelCase fields', async () => {
    const res = await app.request('/api/vendors')
    expect(res.status).toBe(200)
    const vendors = (await res.json()) as { id: string; name: string; abn: string; isApproved: boolean }[]
    expect(vendors.length).toBeGreaterThanOrEqual(6)
    expect(vendors.some((v) => v.isApproved === false)).toBe(true)
  })
})

describe('GET /api/invoices', () => {
  it('lists all seeded invoices', async () => {
    const res = await app.request('/api/invoices')
    expect(res.status).toBe(200)
    const rows = (await res.json()) as { id: string; invoiceNumber: string; vendorName: string; status: string; totalAud: number }[]
    expect(rows.length).toBeGreaterThanOrEqual(20)
    expect(typeof rows[0]!.totalAud).toBe('number')
    expect(rows[0]!.vendorName).toBeTruthy()
  })

  it('filters by status', async () => {
    const res = await app.request('/api/invoices?status=received')
    expect(res.status).toBe(200)
    const rows = (await res.json()) as { status: string }[]
    expect(rows.length).toBeGreaterThanOrEqual(20)
    expect(rows.every((r) => r.status === 'received')).toBe(true)
  })

  it('rejects an invalid status filter with 400', async () => {
    const res = await app.request('/api/invoices?status=not-a-status')
    expect(res.status).toBe(400)
  })
})

describe('GET /api/invoices/:id', () => {
  it('returns the invoice with vendor, lines, a signed pdf url, and null audit/review before any run', async () => {
    const res = await app.request(`/api/invoices/${seededInvoiceId}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      invoice: { id: string; invoiceNumber: string; totalAud: number; status: string }
      vendor: { name: string; abn: string }
      lines: { itemCode: string; lineTotalAud: number }[]
      latestAudit: unknown | null
      reviewDecision: unknown | null
      pdfUrl: string | null
    }
    expect(body.invoice.id).toBe(seededInvoiceId)
    expect(body.vendor.name).toBeTruthy()
    expect(body.lines.length).toBeGreaterThanOrEqual(1)
    expect(typeof body.lines[0]!.lineTotalAud).toBe('number')
    expect(body.latestAudit).toBeNull()
    expect(body.reviewDecision).toBeNull()
    expect(body.pdfUrl).toContain('INV-0001.pdf')
  })

  it('404s an unknown id', async () => {
    const res = await app.request('/api/invoices/00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
  })
})

describe('POST /api/invoices (multipart upload)', () => {
  it('inserts a received invoice, stores the PDF, and returns its id', async () => {
    const form = new FormData()
    form.set('invoiceNumber', `UP-${Date.now()}`)
    form.set('vendorId', (await sql<{ id: string }[]>`select id from vendors limit 1`)[0]!.id)
    form.set('subtotalAud', '1000')
    form.set('gstAud', '100')
    form.set('totalAud', '1100')
    form.set('pdf', new File([TINY_PDF], 'up.pdf', { type: 'application/pdf' }))

    const res = await app.request('/api/invoices', { method: 'POST', body: form })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    expect(id).toBeTruthy()

    const [row] = await sql<{ status: string; pdf_path: string | null }[]>`
      select status, pdf_path from invoices where id = ${id}`
    expect(row!.status).toBe('received')
    expect(row!.pdf_path).toBeTruthy()
  })
})

describe('loadAuditInput (the audit DB loader, T6)', () => {
  it('assembles engine input with numeric coercion for a seeded invoice', async () => {
    const input = await loadAuditInput(unapprovedInvoiceId)
    expect(typeof input.invoice.totalAud).toBe('number')
    expect(input.lines.length).toBeGreaterThanOrEqual(1)
    expect(typeof input.lines[0]!.unitPriceAud).toBe('number')
    expect(input.vendor.isApproved).toBe(false)
    expect(typeof input.po.totalAud).toBe('number')
  })
})
