import type { AuditInput } from './types'

/**
 * Assembles an engine's input for one invoice from the database. Deliberately
 * unimplemented in T5 — the audit seam is built and tested against injected
 * fixtures first; T6 wires this to Supabase (invoice + lines + contract rates +
 * PO + vendor). `auditInvoice` accepts an injected loader, so the seam and its
 * contract test never depend on this.
 */
export const loadAuditInput: (invoiceId: string) => Promise<AuditInput> = () => {
  throw new Error('loadAuditInput is wired to the database in T6')
}
