import { loadAuditInput } from './data'
import { runMockEngine } from './engines/mock'
import { runStubEngine } from './engines/stub'
import type { AuditInput, AuditInputLoader, AuditResult, EngineName } from './types'

/**
 * The audit seam. `auditInvoice` is the ONLY exported way to produce an
 * AuditResult for a real invoice (plan T5, criterion 6) — the API and worker
 * call nothing else. Which engine runs is chosen by env `AUDIT_ENGINE`
 * (`mock` default | `stub`), so the swap needs no code change (criterion 7).
 */

function resolveEngineName(explicit?: EngineName): EngineName {
  if (explicit) return explicit
  return process.env.AUDIT_ENGINE === 'stub' ? 'stub' : 'mock'
}

/** Pure dispatch over already-loaded input — used by the worker and the tests. */
export function runEngine(input: AuditInput, engine?: EngineName): AuditResult {
  switch (resolveEngineName(engine)) {
    case 'stub':
      return runStubEngine()
    case 'mock':
      return runMockEngine(input)
  }
}

/**
 * Audit one invoice by id: load its data, then run the selected engine. The
 * loader defaults to the database (T6) but is injectable so callers and tests
 * can supply fixtures.
 */
export async function auditInvoice(
  invoiceId: string,
  opts: { loader?: AuditInputLoader; engine?: EngineName } = {},
): Promise<AuditResult> {
  const loader = opts.loader ?? loadAuditInput
  const input = await loader(invoiceId)
  return runEngine(input, opts.engine)
}
