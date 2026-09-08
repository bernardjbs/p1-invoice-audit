import { describe, expect, it } from 'vitest'
import { langGraphDefaultDeps } from './engines/langgraph'
import { needsHumanReview } from './pause-rule'

describe('the pause rule', () => {
  it('passes only a clean audit within tolerance', () => {
    expect(needsHumanReview('pass', 0, 0.05)).toBe(false)
    expect(needsHumanReview('pass', 0.05, 0.05)).toBe(false)
  })

  it('stops for a person on any verdict short of a pass', () => {
    expect(needsHumanReview('flag', 0, 0.05)).toBe(true)
    expect(needsHumanReview('fail', 0, 0.05)).toBe(true)
  })

  it('stops for a person when a passing audit is over tolerance', () => {
    expect(needsHumanReview('pass', 0.051, 0.05)).toBe(true)
  })

  /**
   * THE DRIFT GUARD, and the reason this file exists.
   *
   * Two things decide whether an invoice waits for a person: the engine, which
   * suspends itself mid-run, and the worker, which sets the invoice's status.
   * If they ever answered differently the failure is silent and nasty: the
   * engine suspends a run while the worker marks the invoice passed, so the
   * suspended run sits in the database with nothing pointing at it and no
   * approval that can resume it. Nobody sees it; the invoice looks finished.
   *
   * An earlier integration test manufactured exactly that by injecting a
   * different rule into the engine, and the invoice came back `passed` with a
   * live checkpoint behind it. Production cannot do that only because the
   * default wiring reaches for the same function the worker imports. This
   * asserts that it is literally the same function, so replacing it with a
   * copied implementation fails here rather than in production.
   */
  it('is the SAME function in the engine as in the worker', () => {
    expect(langGraphDefaultDeps().needsHumanReview).toBe(needsHumanReview)
  })
})
