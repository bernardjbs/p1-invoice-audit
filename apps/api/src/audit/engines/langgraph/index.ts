import { Command, type BaseCheckpointSaver } from '@langchain/langgraph'
import { downloadInvoicePdf } from '../../../lib/storage'
import { extractInvoiceFields } from '../../extraction'
import { needsHumanReview } from '../../pause-rule'
import { getCheckpointer } from './checkpointer'
import type { AuditResult } from '../../types'
import { runContractTermsCheck } from './contract-terms-agent'
import { buildAuditGraph, runAuditGraph, type AuditGraphDeps, type AuditGraphInput } from './graph'
import { loadPo, loadRates } from './loaders'
import { startAuditTrace, type TraceSink } from './tracing'

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

/**
 * The production wiring: real model, real database, real retrieval.
 *
 * Exported so `pause-rule.test.ts` can assert the engine reaches for the SAME
 * pause rule the worker imports, rather than a copy that can drift.
 */
export function langGraphDefaultDeps(): AuditGraphDeps {
  return {
    // Fetch-then-read. The download lives here, in the wiring, so the bytes exist
    // only for the length of this call and never enter the graph state.
    extract: async (pdfPath) => extractInvoiceFields(await downloadInvoicePdf(pdfPath)),
    loadPo,
    loadRates,
    judgeContractTerms: (invoice, vendorId, poNumber) =>
      runContractTermsCheck(invoice, vendorId, poNumber === undefined ? {} : { poNumber }),
    // The same rule the worker uses to set the invoice's status, so the engine
    // cannot suspend a run the worker then marks as passed.
    needsHumanReview,
  }
}

/**
 * Audit one invoice with the real engine. Returns the same locked shape as every
 * engine.
 *
 * `checkpointer` is injectable so the unit tier can hand in an in-memory saver:
 * without that, importing the seam's test would need a live Postgres, and the
 * CI unit job has none.
 *
 * `traceSink` is where the LangSmith URL comes back. It is an out-parameter
 * because `AuditResult` is locked and may not grow a field for it; see
 * `tracing.ts`. Omitted, the run is still traced — nobody just reads the URL.
 */
export async function runLangGraphEngine(
  input: AuditGraphInput,
  deps: Partial<AuditGraphDeps> = {},
  checkpointer?: BaseCheckpointSaver,
  traceSink?: TraceSink,
): Promise<AuditResult> {
  const saver = checkpointer ?? (await getCheckpointer())

  /**
   * START THE THREAD CLEAN.
   *
   * The thread is keyed by invoice id, so auditing the same invoice twice
   * reuses one thread, and `checks` CONCATENATES by design (four nodes write to
   * it in one step). Without this, a second audit returned eight checks, a third
   * twelve: measured at 20 when the seam's contract test ran the engine five
   * times on one id. A re-audit is a new run, not a continuation of the old one,
   * so its history goes first. Resuming a paused run does NOT come through here.
   *
   * `deleteThread` is on the Postgres saver rather than the base type, hence the
   * capability check: an in-memory saver in a test simply has no history to drop.
   */
  if ('deleteThread' in saver && typeof saver.deleteThread === 'function') {
    await saver.deleteThread(input.invoiceId)
  }

  const trace = await startAuditTrace()
  const result = await runAuditGraph(
    input,
    { ...langGraphDefaultDeps(), ...deps },
    saver,
    trace?.callbacks,
  )
  // After the run, never before: the trace's id does not exist until the root
  // run closes. Resolving it here rather than in the worker keeps the whole
  // observability concern inside the engine that produced it.
  if (trace !== null && traceSink !== undefined) traceSink.url = await trace.url()
  return result
}

/**
 * Continue a suspended audit now that a person has decided.
 *
 * Takes no invoice data: everything the run needs is already in its saved state,
 * which is the whole point of checkpointing. It finds that state by the invoice
 * id and hands the decision back to the `interrupt()` call that is still waiting
 * inside the pause node, which returns it and lets the run finish.
 *
 * IDEMPOTENT BY CONSTRUCTION. Returns `false` when there is nothing suspended
 * under this id: an invoice audited by the mock engine (which never suspends),
 * an approval clicked twice, or a queued resume redelivered after a crash. All
 * three are ordinary, so none of them may throw.
 */
export async function resumeLangGraphEngine(
  invoiceId: string,
  decision: string,
  deps: Partial<AuditGraphDeps> = {},
  checkpointer?: BaseCheckpointSaver,
): Promise<boolean> {
  const saver = checkpointer ?? (await getCheckpointer())
  const graph = buildAuditGraph({ ...langGraphDefaultDeps(), ...deps }, saver)
  const config = { configurable: { thread_id: invoiceId } }

  const snapshot = await graph.getState(config)
  const isWaiting = snapshot.tasks.some((task) => task.interrupts.length > 0)
  if (!isWaiting) return false

  await graph.invoke(new Command({ resume: decision }), config)
  return true
}

export type { AuditGraphDeps, AuditGraphInput } from './graph'
export type { TraceSink } from './tracing'
