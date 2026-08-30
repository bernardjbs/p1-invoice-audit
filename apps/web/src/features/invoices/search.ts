import { z } from 'zod'

/** Typed search params for the invoice list route (plan T10 — status filter). */
export const invoiceSearchSchema = z.object({
  status: z
    .enum(['received', 'auditing', 'passed', 'flagged', 'paused_review', 'approved', 'rejected'])
    .optional(),
})
export type InvoiceSearch = z.infer<typeof invoiceSearchSchema>
