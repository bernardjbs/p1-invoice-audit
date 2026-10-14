import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditResult } from '../../types'
import type { AuditGraphInput } from './graph'

/**
 * The trace is flushed whether or not the caller reads its URL.
 *
 * Resolving the URL is also what sends the queued trace batch. A caller with
 * no sink (the engine integration test, any script) used to skip that step and
 * exit with the batch still queued; the judge's run then sat in LangSmith as
 * "pending" with zero tokens (measured 2026-10-14), so the cost it was meant
 * to evidence was never recorded. This pins the flush to the run, not to the
 * question.
 */

const url = vi.fn(async () => 'https://smith.example/run/1')

vi.mock('./tracing', () => ({
  startAuditTrace: vi.fn(async () => ({ callbacks: [], url })),
}))

vi.mock('./graph', () => ({
  buildAuditGraph: vi.fn(),
  runAuditGraph: vi.fn(
    async (): Promise<AuditResult> => ({ checks: [], verdict: 'pass' }) as never,
  ),
}))

const saver = {} as never
const input = { invoiceId: 'inv-1' } as unknown as AuditGraphInput

describe('runLangGraphEngine and its trace', () => {
  beforeEach(() => url.mockClear())

  it('resolves the trace, and so flushes it, when nobody asked for the URL', async () => {
    const { runLangGraphEngine } = await import('./index')
    await runLangGraphEngine(input, {}, saver)
    expect(url).toHaveBeenCalledTimes(1)
  })

  it('hands the URL to a sink when one is given', async () => {
    const { runLangGraphEngine } = await import('./index')
    const sink = { url: null as string | null }
    await runLangGraphEngine(input, {}, saver, sink)
    expect(url).toHaveBeenCalledTimes(1)
    expect(sink.url).toBe('https://smith.example/run/1')
  })
})
