import './config/load-env'
import type { AuditGraphDeps } from './audit/engines/langgraph/graph'
import type { ExtractedInvoice } from './audit/extraction'
import { runWorkerOnce } from './worker'

/**
 * A worker process for the restart test (plan:
 * 2026-09-04-p1-phase-b-langgraph-engine, task T9, criterion 5).
 *
 * This is the REAL worker loop, the real graph, the real Postgres checkpointer
 * and the real queue. Only the models are fake, because the thing under test is
 * whether a suspended run survives the death of the process that started it, and
 * a vision call would add cost, latency and non-determinism without touching
 * that question.
 *
 * It lives in `src` rather than beside the test because it must be a real
 * entrypoint a child process can be spawned on. Nothing in production imports it.
 *
 * The verdict is forced to `fail` so the invoice always needs a person, which is
 * what makes the run suspend and gives the test something to kill.
 */

const extracted: ExtractedInvoice = {
  invoiceNumber: 'INV-RESTART',
  abn: '51000000680',
  subtotalAud: 1000,
  gstAud: 100,
  totalAud: 1100,
  lines: [
    { itemCode: 'PUMP-100', description: 'Pump', qty: 1, unitPriceAud: 1000, lineTotalAud: 1000 },
  ],
}

const graphDeps: Partial<AuditGraphDeps> = {
  extract: async () => extracted,
  loadPo: async () => ({ poNumber: 'PO-RESTART', totalAud: 1100 }),
  loadRates: async () => [{ itemCode: 'PUMP-100', rateAud: 1000 }],
  judgeContractTerms: async () => ({
    type: 'contract_terms',
    verdict: 'fail',
    evidence: { summary: 'Weekend loading is not permitted.', sourceRef: 'MSA-1 §6' },
  }),
}

async function loop(): Promise<void> {
  // Tells the test this process is actually up, so it can enqueue work rather
  // than sleeping and hoping.
  console.log('restart-fixture worker ready')
  for (;;) {
    await runWorkerOnce({ engine: 'langgraph', graphDeps })
    await new Promise((r) => setTimeout(r, 200))
  }
}

loop().catch((err) => {
  console.error('[restart-fixture] fatal', err)
  process.exit(1)
})
