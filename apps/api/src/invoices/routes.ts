import { Hono } from 'hono'
import { z } from 'zod'
import { INVOICE_STATUSES } from '../db/statuses'
import { enqueueAudit } from '../queue/audit-queue'
import {
  createInvoice,
  getInvoiceDetail,
  listInvoices,
  setInvoiceStatus,
  DuplicateInvoiceNumberError,
} from './service'
import { listSampleHolds, SAMPLE_TTL_MINUTES } from './sample-cleanup'

/**
 * Invoice HTTP routes (plan T6): list (with status filter), detail, and
 * multipart upload. Thin handlers (CONVENTIONS §5) — logic lives in service.ts.
 * Mounted under /api by app.ts.
 */
export const invoicesRoutes = new Hono()

const StatusFilter = z.enum(INVOICE_STATUSES)

const UploadFields = z.object({
  invoiceNumber: z.string().min(1),
  vendorId: z.string().uuid(),
  poId: z.string().uuid().optional(),
  contractId: z.string().uuid().optional(),
  subtotalAud: z.coerce.number().nonnegative(),
  gstAud: z.coerce.number().nonnegative(),
  totalAud: z.coerce.number().nonnegative(),
})

invoicesRoutes.get('/invoices', async (c) => {
  const raw = c.req.query('status')
  let status: string | undefined
  if (raw !== undefined) {
    const parsed = StatusFilter.safeParse(raw)
    if (!parsed.success)
      return c.json({ error: { message: 'invalid status filter', code: 'bad_status' } }, 400)
    status = parsed.data
  }
  return c.json(await listInvoices(status), 200)
})

invoicesRoutes.get('/invoices/:id', async (c) => {
  const detail = await getInvoiceDetail(c.req.param('id'))
  if (!detail) return c.json({ error: { message: 'invoice not found', code: 'not_found' } }, 404)
  return c.json(detail, 200)
})

/**
 * Which sample invoices are currently taken, so the upload page can grey a
 * sample out with a countdown instead of letting a visitor press it and meet a
 * 409 that somebody else caused. Public and read-only: it returns invoice
 * numbers the page already prints.
 */
invoicesRoutes.get('/samples/holds', async (c) =>
  c.json({ ttlMinutes: SAMPLE_TTL_MINUTES, holds: await listSampleHolds() }, 200),
)

invoicesRoutes.post('/invoices', async (c) => {
  const body = await c.req.parseBody()
  const fields = UploadFields.safeParse(body)
  if (!fields.success)
    return c.json({ error: { message: 'invalid invoice fields', code: 'bad_fields' } }, 400)

  const pdf = body['pdf']
  if (!(pdf instanceof File))
    return c.json({ error: { message: 'pdf file is required', code: 'no_pdf' } }, 400)
  const bytes = new Uint8Array(await pdf.arrayBuffer())

  let id: string
  try {
    id = await createInvoice({ ...fields.data, pdf: bytes })
  } catch (err) {
    // Named here rather than left to the central handler: a taken invoice number
    // is an expected outcome the visitor can act on, and a generic 500 told them
    // only that something broke. The sample invoices make this routine, because
    // "Use this" fills the number printed on the PDF.
    if (err instanceof DuplicateInvoiceNumberError) {
      return c.json(
        {
          error: {
            message: `invoice number ${err.invoiceNumber} already exists — choose another`,
            code: 'duplicate_invoice_number',
          },
        },
        409,
      )
    }
    throw err
  }
  // Auto-enqueue the audit on upload and mark it auditing (plan T7).
  await enqueueAudit(id)
  await setInvoiceStatus(id, 'auditing')
  return c.json({ id }, 201)
})

invoicesRoutes.post('/invoices/:id/audit', async (c) => {
  const id = c.req.param('id')
  const detail = await getInvoiceDetail(id)
  if (!detail) return c.json({ error: { message: 'invoice not found', code: 'not_found' } }, 404)
  await enqueueAudit(id)
  await setInvoiceStatus(id, 'auditing')
  return c.json({ status: 'queued' }, 202)
})
