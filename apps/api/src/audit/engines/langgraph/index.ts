import { downloadInvoicePdf } from '../../../lib/storage'
import { extractInvoiceFields } from '../../extraction'
import { getCheckpointer } from './checkpointer'
import type { AuditResult } from '../../types'
import { runContractTermsCheck } from './contract-terms-agent'
import { runAuditGraph, type AuditGraphDeps, type AuditGraphInput } from './graph'
import { loadPo, loadRates } from './loaders'

/**
 * The LangGraph engine, assembled.
 *
 * `graph.ts` owns the wiring and knows nothing about where its data comes from;
 * this file supplies the real vision model, the real SQL loaders and the real
 * contract-terms agent. Keeping the two apart is what lets the unit tier run the
 * genuine graph with no credentials and no database.
 *
 * Every dependency is overridable, so a caller can swap one part — a cheaper
 * model, a stub retriever — without a second engine.
 */

/** The production wiring: real model, real database, real retrieval. */
function defaultDeps(): AuditGraphDeps {
  return {
    // Fetch-then-read. The download lives here, in the wiring, so the bytes exist
    // only for the length of this call and never enter the graph state.
    extract: async (pdfPath) => extractInvoiceFields(await downloadInvoicePdf(pdfPath)),
    loadPo,
    loadRates,
    judgeContractTerms: (invoice, vendorId, poNumber) =>
      runContractTermsCheck(invoice, vendorId, poNumber === undefined ? {} : { poNumber }),
  }
}

/** Audit one invoice with the real engine. Returns the same locked shape as every engine. */
export async function runLangGraphEngine(
  input: AuditGraphInput,
  deps: Partial<AuditGraphDeps> = {},
): Promise<AuditResult> {
  return runAuditGraph(input, { ...defaultDeps(), ...deps }, await getCheckpointer())
}

export type { AuditGraphDeps, AuditGraphInput } from './graph'
