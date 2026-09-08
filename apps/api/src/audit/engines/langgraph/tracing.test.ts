import { afterEach, describe, expect, it } from 'vitest'
import { buildTraceUrl, startAuditTrace } from './tracing'

/**
 * The URL shape, and the switch that keeps this tier credential-free. Actually
 * sending a trace needs a key and a network, which the unit tier has neither of
 * — that half is covered by `worker.trace.integration.test.ts`.
 */

describe('buildTraceUrl', () => {
  it('addresses the run inside its tenant and project', () => {
    expect(
      buildTraceUrl('https://apac.smith.langchain.com', 'tenant-1', 'project-1', 'run-1'),
    ).toBe('https://apac.smith.langchain.com/o/tenant-1/projects/p/project-1/r/run-1?poll=true')
  })

  it('does not double the slash when the host carries a trailing one', () => {
    expect(
      buildTraceUrl('https://apac.smith.langchain.com/', 'tenant-1', 'project-1', 'run-1'),
    ).toBe('https://apac.smith.langchain.com/o/tenant-1/projects/p/project-1/r/run-1?poll=true')
  })
})

describe('startAuditTrace', () => {
  const before = process.env.LANGSMITH_TRACING
  afterEach(() => {
    if (before === undefined) delete process.env.LANGSMITH_TRACING
    else process.env.LANGSMITH_TRACING = before
  })

  /**
   * The guard that keeps the unit tier free of secrets. It reads the raw switch
   * BEFORE `config/env`, which throws when the model keys are absent — as they
   * are in CI. If this ever returns a handle here, every langgraph unit test
   * starts demanding Doppler, and the failure names a missing API key rather
   * than the change that caused it. That happened while this task was built.
   */
  it('does not trace, or reach for credentials, when the switch is off', async () => {
    delete process.env.LANGSMITH_TRACING
    await expect(startAuditTrace()).resolves.toBeNull()
  })

  it('does not trace when the switch says anything other than true', async () => {
    process.env.LANGSMITH_TRACING = 'false'
    await expect(startAuditTrace()).resolves.toBeNull()
  })
})
