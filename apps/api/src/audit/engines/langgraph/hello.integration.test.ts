import { ChatAnthropic } from '@langchain/anthropic'
import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { describe, expect, it } from 'vitest'
import { serverEnv } from '../../../config/env'

/**
 * Hello-graph smoke. Plan: 2026-09-04-p1-phase-b-langgraph-engine, task T1.
 *
 * The smallest thing that proves the LangGraph machinery works end to end on this
 * machine: define state, run two nodes, compile, invoke, get a real reply back.
 *
 * It deliberately audits nothing. Its job is to fail LOUDLY and early if the
 * plumbing is wrong — missing key, wrong model id, bad Doppler config — so that
 * when the real four-check graph lands the plumbing is already ruled out.
 *
 * Integration tier: needs live credentials, so it runs under
 * `doppler run -c dev -- …` and is excluded from the default unit tier.
 */

/**
 * The STATE: one object every node reads and writes. Each field declares a
 * reducer saying how a node's update combines with what is already there —
 * `LastValue` (the default) means "the newest write wins", which is what you
 * want for a field only one node owns.
 */
const HelloState = Annotation.Root({
  question: Annotation<string>,
  reply: Annotation<string>,
  formatted: Annotation<string>,
})

const MODEL = 'claude-haiku-4-5'

/** Node 1 — ask the model. Returns ONLY the slice of state it changed. */
async function askNode(state: typeof HelloState.State): Promise<{ reply: string }> {
  const model = new ChatAnthropic({ model: MODEL, apiKey: serverEnv.ANTHROPIC_API_KEY })
  const response = await model.invoke(state.question)
  return { reply: response.text }
}

/** Node 2 — pure formatting. No network, so the graph is not all LLM calls. */
function formatNode(state: typeof HelloState.State): { formatted: string } {
  return { formatted: `[${MODEL}] ${state.reply.trim()}` }
}

const helloGraph = new StateGraph(HelloState)
  .addNode('ask', askNode)
  .addNode('format', formatNode)
  .addEdge(START, 'ask')
  .addEdge('ask', 'format')
  .addEdge('format', END)
  .compile()

describe('hello graph', () => {
  it('runs two nodes and returns a non-empty formatted reply', async () => {
    const result = await helloGraph.invoke({ question: 'Reply with exactly: pong' })

    expect(result.reply.length).toBeGreaterThan(0)
    expect(result.formatted).toContain(MODEL)
    // The formatting node ran AFTER the model node — proving the edge, not just
    // that a model call happened.
    expect(result.formatted).toContain(result.reply.trim())
  }, 30_000)

  it('exposes its node names, so the graph structure is inspectable', async () => {
    const nodes = Object.keys(helloGraph.getGraph().nodes)

    expect(nodes).toContain('ask')
    expect(nodes).toContain('format')
  })
})
