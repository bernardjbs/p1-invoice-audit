/**
 * Response shapes from the invoice API (mirrors apps/api service returns). The
 * audit `Verdict`/check vocabulary is fine to name here — the seam gate is
 * scoped to apps/api/src only; the web renders results, it does not compute them.
 */
export type Verdict = 'pass' | 'flag' | 'fail'
export type CheckType = 'math' | 'price_vs_contract' | 'po_match' | 'contract_terms'

export type InvoiceStatus =
  | 'received'
  | 'auditing'
  | 'passed'
  | 'flagged'
  | 'paused_review'
  | 'approved'
  | 'rejected'

export type InvoiceListItem = {
  id: string
  invoiceNumber: string
  vendorName: string
  status: InvoiceStatus
  invoiceDate: string | null
  totalAud: number
}

export type CheckResult = {
  type: CheckType
  verdict: Verdict
  evidence: { summary: string; expected?: string; actual?: string; sourceRef?: string }
}

export type AuditRunView = {
  engine: string
  overall: Verdict
  variancePct: number
  startedAt: string | null
  finishedAt: string | null
  checks: CheckResult[]
}

export type InvoiceDetail = {
  invoice: {
    id: string
    invoiceNumber: string
    status: InvoiceStatus
    invoiceDate: string | null
    dueDate: string | null
    subtotalAud: number
    gstAud: number
    totalAud: number
  }
  vendor: { id: string; name: string; abn: string | null; isApproved: boolean }
  lines: { itemCode: string; description: string | null; qty: number; unitPriceAud: number; lineTotalAud: number }[]
  latestAudit: AuditRunView | null
  reviewDecision: { decision: string; note: string | null; decidedAt: string | null } | null
  pdfUrl: string | null
}

export type Vendor = { id: string; name: string; abn: string | null; isApproved: boolean }

export type ReviewQueueItem = {
  id: string
  invoiceNumber: string
  vendorName: string
  totalAud: number
  variancePct: number | null
  status: InvoiceStatus
}
