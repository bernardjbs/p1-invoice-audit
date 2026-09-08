import type { BaseCheckpointSaver } from '@langchain/langgraph'
import { loadAuditInput } from './data'
import {
  runLangGraphEngine,
  type AuditGraphDeps,
  type AuditGraphInput,
  type TraceSink,
} from './engines/langgraph'
import { loadGraphInput } from './engines/langgraph/loaders'
import { runMockEngine } from './engines/mock'
import { runStubEngine } from './engines/stub'
import type { AuditInput, AuditInputLoader, AuditResult, EngineName } from './types'

/**
 * The audit seam. `auditInvoice` is the ONLY exported way to produce an
 * AuditResult for a real invoice (criterion 6) — the API and worker call nothing
 * else. Which engine runs is chosen by env `AUDIT_ENGINE`
 * (`mock` default | `stub` | `langgraph`), so the swap needs no code change
 * (criterion 7).
 *
 * The two kinds of engine are fed differently, and that asymmetry is deliberate.
 * `mock`/`stub` are handed a pre-structured bundle read out of the database.
 * `langgraph` is handed three things — an invoice id, a vendor id and the PDF's
 * bytes — because it reads the invoice itself and fetches its own reference
 * data; feeding it the bundle would hand it five fields it throws away, and the
 * bundle does not carry the vendor id it needs. What is identical across both is
 * the only thing callers see: an id in, an `AuditResult` out.
 */

function resolveEngineName(explicit?: EngineName): EngineName {
  if (explicit) return explicit
  const named = process.env.AUDIT_ENGINE
  return named === 'stub' || named === 'langgraph' ? named : 'mock'
}

/**
 * Pure dispatch over an already-loaded bundle — the pre-LangGraph engines only.
 *
 * `langgraph` is reachable here by name but not servable: it needs input this
 * function does not have, and inventing an empty PDF to satisfy the signature
 * would produce four confident findings about nothing. Failing loudly points the
 * caller at the entry point that can do the job.
 */
export function runEngine(input: AuditInput, engine?: EngineName): AuditResult {
  const name = resolveEngineName(engine)
  switch (name) {
    case 'stub':
      return runStubEngine()
    case 'mock':
      return runMockEngine(input)
    case 'langgraph':
      throw new Error(
        'the langgraph engine is not fed AuditInput — call auditInvoice(), which loads its PDF and ids',
      )
  }
}

export type AuditInvoiceOptions = {
  /** Overrides the database bundle for `mock`/`stub`. */
  loader?: AuditInputLoader
  /** Overrides the id+PDF load for `langgraph`. */
  graphLoader?: (invoiceId: string) => Promise<AuditGraphInput>
  /** Overrides parts of the langgraph engine's wiring — the model, the SQL, the agent. */
  graphDeps?: Partial<AuditGraphDeps>
  /**
   * The engine's durable memory. Omitted in production, where the Postgres saver
   * is used; the unit tier passes an in-memory one so it needs no database.
   */
  checkpointer?: BaseCheckpointSaver
  /**
   * Filled in with the run's LangSmith trace URL, when there is one. An
   * out-parameter rather than a field on the result, because the result shape is
   * locked for every engine — only `langgraph` traces, and only it writes here.
   */
  traceSink?: TraceSink
  engine?: EngineName
}

/**
 * Audit one invoice by id. The single door through the seam: everything in front
 * of it passes an id and receives the locked result shape, and nothing in front
 * of it knows which engine ran.
 */
export async function auditInvoice(
  invoiceId: string,
  opts: AuditInvoiceOptions = {},
): Promise<AuditResult> {
  const engine = resolveEngineName(opts.engine)

  if (engine === 'langgraph') {
    const input = await (opts.graphLoader ?? loadGraphInput)(invoiceId)
    return runLangGraphEngine(input, opts.graphDeps ?? {}, opts.checkpointer, opts.traceSink)
  }

  const loader = opts.loader ?? loadAuditInput
  return runEngine(await loader(invoiceId), engine)
}
