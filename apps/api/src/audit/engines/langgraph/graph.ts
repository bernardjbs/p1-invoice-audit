import type { BaseCheckpointSaver } from '@langchain/langgraph'
import { Annotation, END, START, StateGraph, interrupt } from '@langchain/langgraph'
import type { ExtractedInvoice } from '../../extraction'
import {
  CHECK_TYPES,
  type AuditResult,
  type CheckResult,
  type CheckType,
  type Verdict,
} from '../../types'
import {
  runMathCheck,
  runPoMatchCheck,
  runPriceCheck,
  variancePct,
  type ContractRate,
  type PurchaseOrder,
} from './checks'

/**
 * The supervisor graph: the four checks wired into one run.
 *
 * WHY A GRAPH AND NOT A FUNCTION. A function's progress lives on the call stack,
 * which dies with the process. A graph's progress lives in the state object
 * below, which a checkpointer can write to Postgres between steps — so a run can
 * pause for a human and resume in a different process. Nothing here uses that
 * yet; this builds the thing that can, which is why the shape matters more than
 * the line count.
 *
 * WHY THE ARITHMETIC CHECKS ARE PLAIN NODES. Three of the four have a right
 * answer that a calculator gives for free. Routing them through a model would buy
 * nothing and could be wrong. Only `contract_terms` asks a question no sum can
 * answer — does the wording forbid this? — so only it gets a model. That split is
 * the hybrid architecture, and the structure test pins it so a later refactor
 * cannot quietly turn the sums into prompts.
 */

/**
 * The state every node reads and writes. Each field declares how a node's update
 * combines with what is already there — the DEFAULT is last-write-wins, which is
 * right for a field only one node owns.
 *
 * `checks` is the exception, and the reason reducers exist: four nodes write to
 * it in the same step, so last-write-wins would leave three checks on the floor
 * and one in the result. Concatenating is what makes the fan-out safe.
 */
export const AuditState = Annotation.Root({
  invoiceId: Annotation<string>,
  vendorId: Annotation<string>,
  /**
   * The PDF's storage KEY, never its bytes. Every field in this object is written
   * to a checkpoint row after every step once the checkpointer is wired, so a
   * `Buffer` here would serialise the whole document into the database once per
   * node, per audit, to store a file that already lives in Storage. The reading
   * node fetches the bytes, uses them and lets them go.
   */
  pdfPath: Annotation<string>,
  extracted: Annotation<ExtractedInvoice>,
  po: Annotation<PurchaseOrder | null>,
  rates: Annotation<ContractRate[]>,
  checks: Annotation<CheckResult[]>({
    reducer: (existing, update) => existing.concat(update),
    default: () => [],
  }),
  variancePct: Annotation<number>,
  overall: Annotation<Verdict>,
})

export type AuditStateType = typeof AuditState.State

/**
 * Everything the graph needs from outside the process, in one bag.
 *
 * Injected rather than imported so the unit tier runs the real wiring with no
 * model, no database and no credentials. The defaults live in `index.ts`, where
 * the engine is assembled — this file stays honest about what it depends on.
 */
export type AuditGraphDeps = {
  /**
   * Read the invoice fields off the PDF (fetch by storage key, then Claude vision
   * in production). Takes the KEY rather than the bytes so the bytes never enter
   * the graph state, and therefore never reach a checkpoint row.
   */
  extract: (pdfPath: string) => Promise<ExtractedInvoice>
  /** The purchase order this invoice was raised against, or null if it has none. */
  loadPo: (invoiceId: string) => Promise<PurchaseOrder | null>
  /** The vendor's agreed rate card. */
  loadRates: (vendorId: string) => Promise<ContractRate[]>
  /** The reading check: retrieval + model + forced citation, already assembled. */
  judgeContractTerms: (
    invoice: ExtractedInvoice,
    vendorId: string,
    poNumber?: string,
  ) => Promise<CheckResult>
  /**
   * Whether this result must stop for a person. Injected rather than imported so
   * a test can pin the policy without touching the environment, and so the graph
   * and the worker provably share one rule (`audit/pause-rule.ts`) instead of
   * keeping two copies that can drift apart.
   */
  needsHumanReview: (overall: Verdict, variancePct: number) => boolean
}

/** Overall verdict is the worst individual verdict — one fail outranks three passes. */
function rollUp(checks: CheckResult[]): Verdict {
  if (checks.some((c) => c.verdict === 'fail')) return 'fail'
  if (checks.some((c) => c.verdict === 'flag')) return 'flag'
  return 'pass'
}

/**
 * Order the checks the way the contract lists them.
 *
 * The four check nodes finish in whatever order their work happens to take, and
 * a result whose fields shuffle between runs reads as a bug in the UI and breaks
 * byte-comparison in the tests. Sorting here makes the output a function of the
 * invoice alone, never of timing.
 */
const CHECK_ORDER = new Map<CheckType, number>(CHECK_TYPES.map((type, i) => [type, i]))

function inContractOrder(checks: CheckResult[]): CheckResult[] {
  return [...checks].sort((a, b) => CHECK_ORDER.get(a.type)! - CHECK_ORDER.get(b.type)!)
}

/**
 * Build the graph. Two independent starts — reading the PDF and loading the
 * reference data have nothing to say to each other, so they run at the same time
 * and the checks wait for both. Then four checks in parallel, then one aggregate.
 *
 *            ┌─ extract ─┐
 *   START ──►│           ├──► math · po_match · price · contract_terms ──► aggregate ──► pause ──► END
 *            └─ load ────┘                                                                  │
 *                                                                    suspends here when a human is needed,
 *                                                                    and resumes on the same thread later
 */
export function buildAuditGraph(deps: AuditGraphDeps, checkpointer?: BaseCheckpointSaver) {
  const CHECK_NODES = ['math', 'po_match', 'price', 'contract_terms'] as const

  const graph = new StateGraph(AuditState)
    .addNode('extract', async (state) => ({ extracted: await deps.extract(state.pdfPath) }))
    .addNode('load', async (state) => ({
      po: await deps.loadPo(state.invoiceId),
      rates: await deps.loadRates(state.vendorId),
    }))
    .addNode('math', (state) => ({ checks: [runMathCheck(state.extracted)] }))
    .addNode('po_match', (state) => ({ checks: [runPoMatchCheck(state.extracted, state.po)] }))
    .addNode('price', (state) => ({
      checks: [runPriceCheck(state.extracted, state.rates)],
      variancePct: variancePct(state.extracted, state.rates),
    }))
    .addNode('contract_terms', async (state) => ({
      checks: [await deps.judgeContractTerms(state.extracted, state.vendorId, state.po?.poNumber)],
    }))
    .addNode('aggregate', (state) => ({ overall: rollUp(state.checks) }))
    /**
     * The human gate. Its own node, AFTER aggregate, and that is not cosmetic: a
     * node that interrupts never reaches its return statement, so computing the
     * overall verdict here would mean the verdict was never written to state and
     * a paused run would surface with no result at all.
     *
     * SAFE TO RUN TWICE. On resume the interrupted node re-runs from its first
     * line, so everything before `interrupt()` happens again. Here that is one
     * comparison over values already in state. Nothing that writes, sends or
     * charges may ever go above this line: persisting belongs to the worker,
     * after the run comes back.
     */
    .addNode('pause', (state) => {
      if (!deps.needsHumanReview(state.overall, state.variancePct)) return {}
      // Returns the decision when resumed; throws GraphInterrupt the first time.
      // Deliberately not wrapped in try/catch: that error is control flow.
      interrupt({
        invoiceId: state.invoiceId,
        overall: state.overall,
        variancePct: state.variancePct,
      })
      return {}
    })
    .addEdge(START, 'extract')
    .addEdge(START, 'load')
    .addEdge([...CHECK_NODES], 'aggregate')
    .addEdge('aggregate', 'pause')
    .addEdge('pause', END)

  // Every check waits for BOTH starts: they all read the extracted invoice, and
  // three of them also read what `load` fetched.
  for (const node of CHECK_NODES) graph.addEdge(['extract', 'load'], node)

  // Optional on purpose: with no checkpointer the graph runs entirely in memory,
  // which is what lets the unit tier exercise the real wiring with no database
  // and no credentials. Production passes one; tests mostly do not.
  return checkpointer === undefined ? graph.compile() : graph.compile({ checkpointer })
}

/** What one audit run needs. Deliberately narrow: the engine fetches its own facts. */
export type AuditGraphInput = {
  invoiceId: string
  vendorId: string
  /** Storage key, not bytes — see `AuditState.pdfPath`. */
  pdfPath: string
}

/** Run one invoice through the graph and shape the final state into the locked result. */
export async function runAuditGraph(
  input: AuditGraphInput,
  deps: AuditGraphDeps,
  checkpointer?: BaseCheckpointSaver,
): Promise<AuditResult> {
  // THREAD IDENTITY. `thread_id` is the key the saver files this run's state
  // under, and the key a later process uses to find it again. Using the invoice
  // id makes that mapping the obvious one: one invoice, one resumable run, no
  // side table translating between our ids and the engine's. Harmless when no
  // checkpointer is wired; required the moment one is.
  const final = await buildAuditGraph(deps, checkpointer).invoke(input, {
    configurable: { thread_id: input.invoiceId },
  })

  return {
    engine: 'langgraph',
    overall: final.overall,
    variancePct: final.variancePct,
    checks: inContractOrder(final.checks),
  }
}
