import { describe, expect, it } from 'vitest'
import { DEFAULT_JUDGE_MODEL } from './engines/langgraph/contract-terms-agent'
import { DEFAULT_EXTRACTION_MODEL } from './extraction'

/**
 * The two default model IDs, pinned.
 *
 * They are the engine's identity, not a tuning knob. The eval dataset's scores
 * were measured against these exact models, so changing one silently makes every
 * recorded score describe an engine that no longer runs; and each is billed per
 * call on every invoice, so a quiet tier change is a quiet cost change. A swap
 * must be deliberate: edit this test, rebuild the dataset, re-record the score.
 */
describe('default audit models', () => {
  it('reads invoices with Haiku 5.5', () => {
    expect(DEFAULT_EXTRACTION_MODEL).toBe('claude-haiku-5-5')
  })

  it('judges contract terms with Sonnet 5.5', () => {
    expect(DEFAULT_JUDGE_MODEL).toBe('claude-sonnet-5-5')
  })
})
