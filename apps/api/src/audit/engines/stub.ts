import { CHECK_TYPES, type AuditResult } from '../types'

/**
 * A second, trivially different engine whose only job is to prove the seam
 * seals (plan T5, criterion 7): swapping the engine changes nothing but this
 * file. It passes every check with fixed evidence, ignoring the input entirely
 * (hence it takes none).
 */
export function runStubEngine(): AuditResult {
  return {
    engine: 'stub',
    overall: 'pass',
    variancePct: 0,
    checks: CHECK_TYPES.map((type) => ({
      type,
      verdict: 'pass' as const,
      evidence: { summary: `Stub engine: ${type} not evaluated.` },
    })),
  }
}
