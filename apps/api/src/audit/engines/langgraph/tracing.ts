import type { BaseCallbackHandler } from '@langchain/core/callbacks/base'

/**
 * LangSmith tracing for the LangGraph engine.
 *
 * WHY THIS EXISTS. A graph run is a fan-out of six nodes, two of which call a
 * model. When a verdict looks wrong the only useful question is "what did the
 * model actually see?", and nothing in the database answers it — the audit run
 * stores conclusions, not the prompts and tool results that produced them. A
 * trace does, so every run records the URL of its own trace and the detail view
 * links straight to it.
 *
 * TWO THINGS ARE DELIBERATE HERE.
 *
 * 1. The region. Bernard's LangSmith workspace is APAC. The US and EU hosts
 *    answer an otherwise valid APAC key with 403, which reads as a bad key
 *    rather than a wrong region and costs an hour. So the endpoint is required
 *    rather than defaulted: with no `LANGSMITH_ENDPOINT` set, tracing is refused
 *    and the run proceeds untraced.
 *
 * 2. Every import is dynamic. `config/env` parses (and, when a key is missing,
 *    throws) at module load, so a top-level import would drag secrets into the
 *    unit tier, which runs in CI with none. The same lazy pattern as
 *    `extraction.ts` and `retrieval.ts`.
 */

/** The LangSmith project every audit run is traced into. */
export const LANGSMITH_PROJECT_NAME = 'p1-invoice-audit'

/**
 * A trace attached to one audit run: the callbacks that record it, and the URL
 * it can afterwards be read at.
 */
export type AuditTrace = {
  /** Attach to the graph's invoke config. Empty is never returned — no trace, no handle. */
  callbacks: BaseCallbackHandler[]
  /**
   * The trace's URL, or null when it cannot be resolved. Resolvable only after
   * the run has finished, since the run id is not known until then.
   */
  url: () => Promise<string | null>
}

/**
 * Where the engine reports the trace URL, out of band from `AuditResult`.
 *
 * The result shape is locked — every engine returns exactly those fields — so a
 * trace URL cannot ride on it. A mutable sink passed in by the caller keeps the
 * contract intact and stays explicit: the worker creates one, the engine fills
 * it in if it traced, and `null` survives every path that did not.
 */
export type TraceSink = { url: string | null }

/**
 * The run's page in the LangSmith UI.
 *
 * Kept pure and separate from the client calls so it can be asserted without a
 * network, and so the shape is stated in one place rather than assembled inline.
 * `poll=true` is what LangSmith's own links carry: it makes the page refresh
 * while a run is still streaming, which is the common case for a link opened
 * seconds after an audit.
 */
export function buildTraceUrl(
  hostUrl: string,
  tenantId: string,
  projectId: string,
  runId: string,
): string {
  return `${hostUrl.replace(/\/$/, '')}/o/${tenantId}/projects/p/${projectId}/r/${runId}?poll=true`
}

/** Resolved once per process: the ids in a trace URL never change between runs. */
let projectRef: { tenantId: string; projectId: string } | null = null

/**
 * Begin tracing one audit run, or return null when tracing is off or unusable.
 *
 * Null rather than throwing, on purpose: observability must never be able to
 * fail an audit. Every failure below degrades to an untraced run with a warning,
 * and the audit's own result is unaffected.
 */
export async function startAuditTrace(): Promise<AuditTrace | null> {
  /**
   * The raw switch, read BEFORE the validated environment, and that order is
   * load-bearing. Every langgraph run passes through here, including the unit
   * tier's, and importing `config/env` throws when the model keys are absent —
   * which is exactly the CI unit job. Reading one unvalidated boolean is the
   * price of keeping the whole tier credential-free; `tracing.test.ts` pins it.
   */
  if (process.env.LANGSMITH_TRACING !== 'true') return null

  const { serverEnv } = await import('../../../config/env')
  const endpoint = serverEnv.LANGSMITH_ENDPOINT
  const apiKey = serverEnv.LANGSMITH_API_KEY
  if (endpoint === undefined || apiKey === undefined) {
    console.warn('[tracing] LANGSMITH_TRACING is on but the endpoint or key is unset — not tracing')
    return null
  }

  const [{ Client }, { LangChainTracer }, { RunCollectorCallbackHandler }] = await Promise.all([
    import('langsmith'),
    import('@langchain/core/tracers/tracer_langchain'),
    import('@langchain/core/tracers/run_collector'),
  ])

  const client = new Client({ apiUrl: endpoint, apiKey })
  const tracer = new LangChainTracer({ client, projectName: LANGSMITH_PROJECT_NAME })
  /**
   * The collector is how we learn the run id. It sends nothing; it just keeps
   * the finished root run in memory. The callback manager generates ONE run id
   * and hands it to every handler, so the id the collector sees is the same id
   * the tracer filed under — which is why this does not need the tracer's
   * internals or a pre-seeded `runId` on the config.
   */
  const collector = new RunCollectorCallbackHandler()

  /**
   * Supplying our own `langchain_tracer` also SUPPRESSES the ambient one that
   * `CallbackManager.configure` would otherwise add from the environment. That
   * matters: two tracers means two traces per audit, in two projects, billed
   * twice.
   */
  return {
    callbacks: [tracer, collector],
    url: async () => {
      const runId = collector.tracedRuns[0]?.id
      if (runId === undefined) return null
      try {
        // Flush before reading: the project is created by LangSmith on first
        // ingest, so looking it up before the batch has gone out 404s on a fresh
        // workspace. It also means a short-lived process (a test, a serverless
        // invocation) cannot exit with the trace still queued.
        await client.awaitPendingTraceBatches()
        projectRef ??= await readProjectRef(client)
        return buildTraceUrl(client.getHostUrl(), projectRef.tenantId, projectRef.projectId, runId)
      } catch (err) {
        console.warn('[tracing] could not resolve the trace URL:', err)
        return null
      }
    },
  }
}

type ProjectReader = {
  readProject: (args: { projectName: string }) => Promise<{ id: string; tenant_id: string }>
}

/**
 * The tenant and project ids the URL is built from.
 *
 * Retried because ingest is asynchronous on LangSmith's side: the first audit in
 * a fresh workspace can flush its batch and still find the project a beat later.
 * Three quick attempts turn that race into a delay rather than a null URL.
 */
async function readProjectRef(
  client: ProjectReader,
): Promise<{ tenantId: string; projectId: string }> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const project = await client.readProject({ projectName: LANGSMITH_PROJECT_NAME })
      return { tenantId: project.tenant_id, projectId: project.id }
    } catch (err) {
      lastError = err
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw lastError
}
