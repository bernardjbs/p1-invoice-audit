/**
 * What counts as an invoice the post-deploy smoke created.
 *
 * Its own module, with no imports, for two reasons: it is the safety rail that
 * keeps the cleanup script away from real data, so it is worth testing on its
 * own; and a test at the repo root cannot resolve the API package's
 * dependencies, which the cleanup script pulls in.
 */
export const SMOKE_PREFIX = 'SMOKE-'

export function isSmokeInvoiceNumber(n: string): boolean {
  return n.startsWith(SMOKE_PREFIX)
}
