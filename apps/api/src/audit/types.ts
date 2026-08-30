import { z } from 'zod'

/**
 * The LOCKED audit-result shape (plan T5, criterion 6). Every engine — the
 * Phase-A mock, the swap-proof stub, and the Phase-B LangGraph engine — returns
 * exactly this. Change it here and nowhere else; the contract test in
 * engine.test.ts pins it, and the seam gate (scripts/seam-gate.sh) keeps
 * `CheckResult`/`check_type` from leaking outside this folder.
 */

// The four checks a P1 audit always produces — one result per type, no more.
export const CHECK_TYPES = ['math', 'price_vs_contract', 'po_match', 'contract_terms'] as const
export type CheckType = (typeof CHECK_TYPES)[number]

export const VERDICTS = ['pass', 'flag', 'fail'] as const
export type Verdict = (typeof VERDICTS)[number]

export const EvidenceSchema = z.object({
  summary: z.string(),
  expected: z.string().optional(),
  actual: z.string().optional(),
  sourceRef: z.string().optional(),
})
export type Evidence = z.infer<typeof EvidenceSchema>

export const CheckResultSchema = z.object({
  type: z.enum(CHECK_TYPES),
  verdict: z.enum(VERDICTS),
  evidence: EvidenceSchema,
})
export type CheckResult = z.infer<typeof CheckResultSchema>

export const AuditResultSchema = z.object({
  engine: z.string(),
  overall: z.enum(VERDICTS),
  variancePct: z.number(),
  // Exactly four checks, one per type — the cardinality is the contract.
  checks: z
    .array(CheckResultSchema)
    .length(CHECK_TYPES.length)
    .refine((cs) => new Set(cs.map((c) => c.type)).size === CHECK_TYPES.length, {
      message: 'checks must contain exactly one result per check type',
    }),
})
export type AuditResult = z.infer<typeof AuditResultSchema>

/**
 * Everything an engine needs to audit one invoice, assembled by the caller
 * (the DB loader in T6). Keeping the engines pure over this — rather than
 * letting them reach into the database — is what makes the seam testable
 * without a live DB and swappable without touching the API.
 */
export type AuditInput = {
  invoice: {
    id: string
    invoiceNumber: string
    subtotalAud: number
    gstAud: number
    totalAud: number
  }
  lines: {
    itemCode: string
    description: string
    qty: number
    unitPriceAud: number
    lineTotalAud: number
  }[]
  contractRates: { itemCode: string; rateAud: number }[]
  po: { poNumber: string; totalAud: number }
  vendor: { name: string; isApproved: boolean }
}

/** A function that assembles an engine's input for one invoice id (DB in T6). */
export type AuditInputLoader = (invoiceId: string) => Promise<AuditInput>

/** The name of an engine implementation, chosen by env `AUDIT_ENGINE`. */
export type EngineName = 'mock' | 'stub'
