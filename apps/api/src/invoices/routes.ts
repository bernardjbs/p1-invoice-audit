import { Hono } from 'hono'
import { z } from 'zod'
import { INVOICE_STATUSES } from '../db/statuses'
import { enqueueAudit } from '../queue/audit-queue'
import { createInvoice, getInvoiceDetail, listInvoices, setInvoiceStatus } from './service'

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

invoicesRoutes.post('/invoices', async (c) => {
  const body = await c.req.parseBody()
  const fields = UploadFields.safeParse(body)
  if (!fields.success)
    return c.json({ error: { message: 'invalid invoice fields', code: 'bad_fields' } }, 400)

  const pdf = body['pdf']
  if (!(pdf instanceof File))
    return c.json({ error: { message: 'pdf file is required', code: 'no_pdf' } }, 400)
  const bytes = new Uint8Array(await pdf.arrayBuffer())

  const id = await createInvoice({ ...fields.data, pdf: bytes })
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
