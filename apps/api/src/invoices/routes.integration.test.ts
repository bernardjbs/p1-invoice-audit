import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../app'
import { sql } from '../db/client'
import { loadAuditInput } from '../audit/data'
import { downloadInvoicePdf } from '../lib/storage'

/**
 * API read + upload endpoints (plan T6) + the audit DB loader. Integration tier:
 * runs against the local Supabase (Postgres + Storage), which must be up and
 * seeded (`bunx supabase db reset && bun run seed`). Env is loaded by
 * vitest.integration.config.ts.
 */

// A tiny valid PDF (header + minimal body) for the upload test.
const TINY_PDF = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
])

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
    const vendors = (await res.json()) as {
      id: string
      name: string
      abn: string
      isApproved: boolean
    }[]
    expect(vendors.length).toBeGreaterThanOrEqual(6)
    expect(vendors.some((v) => v.isApproved === false)).toBe(true)
  })
})

describe('GET /api/invoices', () => {
  it('lists all seeded invoices', async () => {
    const res = await app.request('/api/invoices')
    expect(res.status).toBe(200)
    const rows = (await res.json()) as {
      id: string
      invoiceNumber: string
      vendorName: string
      status: string
      totalAud: number
    }[]
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
    // Upload auto-enqueues the audit (plan T7), so the invoice is now auditing.
    expect(row!.status).toBe('auditing')
    expect(row!.pdf_path).toBeTruthy()
  })

  /**
   * Two assertions, because the duplicate had two failure modes and only one of
   * them was visible. It answered 500 `internal server error`, which told a
   * visitor nothing; and, because the PDF was stored before the insert under a
   * path built from the invoice number with upsert on, it REPLACED the stored
   * document of the invoice that already held that number. The original kept its
   * audit findings and pointed at a different page.
   */
  it('rejects a duplicate invoice number with 409 and leaves the original PDF alone', async () => {
    const number = `UP-DUP-${Date.now()}`
    const vendorId = (await sql<{ id: string }[]>`select id from vendors limit 1`)[0]!.id

    const first = new FormData()
    first.set('invoiceNumber', number)
    first.set('vendorId', vendorId)
    first.set('subtotalAud', '1000')
    first.set('gstAud', '100')
    first.set('totalAud', '1100')
    first.set('pdf', new File([TINY_PDF], 'first.pdf', { type: 'application/pdf' }))
    const created = await app.request('/api/invoices', { method: 'POST', body: first })
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: string }

    // A DIFFERENT document, so an overwrite would be detectable.
    const OTHER_PDF = new Uint8Array([...TINY_PDF, 0x0a, 0x25, 0x25, 0x45, 0x4f, 0x46])
    const second = new FormData()
    second.set('invoiceNumber', number)
    second.set('vendorId', vendorId)
    second.set('subtotalAud', '1')
    second.set('gstAud', '1')
    second.set('totalAud', '2')
    second.set('pdf', new File([OTHER_PDF], 'second.pdf', { type: 'application/pdf' }))
    const rejected = await app.request('/api/invoices', { method: 'POST', body: second })

    expect(rejected.status).toBe(409)
    const body = (await rejected.json()) as { error: { message: string; code: string } }
    expect(body.error.code).toBe('duplicate_invoice_number')
    expect(body.error.message).toContain(number)

    // The rejected upload must not have created a second row, nor changed the first.
    const rows = await sql<{ id: string }[]>`
      select id from invoices where invoice_number = ${number}`
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(id)

    const stored = await downloadInvoicePdf(`${number}.pdf`)
    expect(Array.from(stored)).toEqual(Array.from(TINY_PDF))
  })
})

// Remove invoices this file uploads so the tier is re-runnable without a reset.
afterAll(async () => {
  await sql`delete from invoices where invoice_number like 'UP-%'`
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
