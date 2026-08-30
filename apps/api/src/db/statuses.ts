/**
 * The invoice status lifecycle — the single source of truth mirroring the DB
 * check constraint in the schema migration. Used to validate status filters and
 * drive the review workflow (T7/T8). Keep in step with the migration's
 * `invoices.status check (...)`.
 */
export const INVOICE_STATUSES = [
  'received',
  'auditing',
  'passed',
  'flagged',
  'paused_review',
  'approved',
  'rejected',
] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]
